import {
  K,
  minValue,
  tweenTypes,
  valueTypes,
  compositionTypes,
  isDomSymbol,
} from '../core/consts.js';

import {
  mergeObjects,
  cloneArray,
  isArr,
  isObj,
  isUnd,
  isKey,
  addChild,
  forEachChildren,
  clampInfinity,
  normalizeTime,
  isNum,
  round,
  isNil,
  isFnc,
  isStr,
} from '../core/helpers.js';

import {
  globals,
} from '../core/globals.js';

import {
  registerTargets,
} from '../core/targets.js';

import {
  getRelativeValue,
  getFunctionValue,
  getOriginalAnimatableValue,
  getTweenType,
  setValue,
  decomposeRawValue,
  decomposeTweenValue,
  createDecomposedValueTargetObject,
} from '../core/values.js';

import {
  sanitizePropertyName,
  cleanInlineStyles,
} from '../core/styles.js';

import {
  convertValueUnit,
} from '../core/units.js';

import {
  parseEase,
} from '../easings/eases/parser.js';

import {
  Timer,
} from '../timer/timer.js';

import {
  composeTween,
  getTweenSiblings,
  overrideTween,
} from './composition.js';

import {
  additive,
} from './additive.js';

/**
 * @import {
 *   Tween,
 *   TweenKeyValue,
 *   TweenParamsOptions,
 *   TweenValues,
 *   DurationKeyframes,
 *   PercentageKeyframes,
 *   AnimationParams,
 *   TweenPropValue,
 *   ArraySyntaxValue,
 *   TargetsParam,
 *   TimerParams,
 *   TweenParamValue,
 *   DOMTarget,
 *   TargetsArray,
 *   Callback,
 *   EasingFunction,
 * } from '../types/index.js'
 *
 * @import {
 *   Timeline,
 * } from '../timeline/timeline.js'
 *
 * @import {
 *   Spring,
 * } from '../easings/spring/index.js'
 */

let tweenId = 0;
let JSAnimationId = 0;

const createAnimationContext = () => ({
  fromTargetObject: createDecomposedValueTargetObject(),
  toTargetObject: createDecomposedValueTargetObject(),
  decomposedOriginalValue: createDecomposedValueTargetObject(),
  inlineStylesStore: {},
  toFunctionStore: { func: null },
  fromFunctionStore: { func: null },
  keyframesTargetArray: [null],
  fastSetValuesArray: [null, null],
  keyObjectTarget: { to: null },
});

/**
 * @param {DurationKeyframes | PercentageKeyframes} keyframes
 * @param {AnimationParams} parameters
 * @return {AnimationParams}
 */
const generateKeyframes = (keyframes, parameters) => {
  /** @type {AnimationParams} */
  const properties = {};
  if (isArr(keyframes)) {
    const propertyNames = [].concat(.../** @type {DurationKeyframes} */(keyframes).map(key => Object.keys(key))).filter(isKey);
    for (let i = 0, l = propertyNames.length; i < l; i++) {
      const propName = propertyNames[i];
      const propArray = /** @type {DurationKeyframes} */(keyframes).map(key => {
        /** @type {TweenKeyValue} */
        const newKey = {};
        for (let p in key) {
          const keyValue = /** @type {TweenPropValue} */(key[p]);
          if (isKey(p)) {
            if (p === propName) {
              newKey.to = keyValue;
            }
          } else {
            newKey[p] = keyValue;
          }
        }
        return newKey;
      });
      properties[propName] = /** @type {ArraySyntaxValue} */(propArray);
    }

  } else {
    const totalDuration = /** @type {Number} */(setValue(parameters.duration, globals.defaults.duration));
    const keys = Object.keys(keyframes)
    .map(key => { return {o: parseFloat(key) / 100, p: keyframes[key]} })
    .sort((a, b) => a.o - b.o);
    keys.forEach(key => {
      const offset = key.o;
      const prop = key.p;
      for (let name in prop) {
        if (isKey(name)) {
          let propArray = /** @type {Array} */(properties[name]);
          if (!propArray) propArray = properties[name] = [];
          const duration = offset * totalDuration;
          let length = propArray.length;
          let prevKey = propArray[length - 1];
          const keyObj = { to: prop[name] };
          let durProgress = 0;
          for (let i = 0; i < length; i++) {
            durProgress += propArray[i].duration;
          }
          if (length === 1) {
            keyObj.from = prevKey.to;
          }
          if (prop.ease) {
            keyObj.ease = prop.ease;
          }
          keyObj.duration = duration - (length ? durProgress : 0);
          propArray.push(keyObj);
        }
      }
      return key;
    });

    for (let name in properties) {
      const propArray = /** @type {Array} */(properties[name]);
      let prevEase;
      // let durProgress = 0
      for (let i = 0, l = propArray.length; i < l; i++) {
        const prop = propArray[i];
        // Emulate WAPPI easing parameter position
        const currentEase = prop.ease;
        prop.ease = prevEase ? prevEase : undefined;
        prevEase = currentEase;
        // durProgress += prop.duration;
        // if (i === l - 1 && durProgress !== totalDuration) {
        //   propArray.push({ from: prop.to, ease: prop.ease, duration: totalDuration - durProgress })
        // }
      }
      if (!propArray[0].duration) {
        propArray.shift();
      }
    }

  }

  return properties;
}

export class JSAnimation extends Timer {
  /**
   * @param {TargetsParam} targets
   * @param {AnimationParams} parameters
   * @param {Timeline} [parent]
   * @param {Number} [parentPosition]
   * @param {Boolean} [fastSet=false]
   * @param {Number} [index=0]
   * @param {Number} [length=0]
   */
  constructor(
    targets,
    parameters,
    parent,
    parentPosition,
    fastSet = false,
    index = 0,
    length = 0
  ) {

    super(/** @type {TimerParams & AnimationParams} */(parameters), parent, parentPosition);

    ++JSAnimationId;

    const ctx = createAnimationContext();

    const parsedTargets = registerTargets(targets);
    const targetsLength = parsedTargets.length;

    // If the parameters object contains a "keyframes" property, convert all the keyframes values to regular properties

    const kfParams = /** @type {AnimationParams} */(parameters).keyframes;
    const params = /** @type {AnimationParams} */(kfParams ? mergeObjects(generateKeyframes(/** @type {DurationKeyframes} */(kfParams), parameters), parameters) : parameters);

    const {
      id,
      delay,
      duration,
      ease,
      playbackEase,
      modifier,
      composition,
      onRender,
    } = params;

    const animDefaults = parent ? parent.defaults : globals.defaults;
    const animEase = setValue(ease, animDefaults.ease);
    const animPlaybackEase = setValue(playbackEase, animDefaults.playbackEase);
    const parsedAnimPlaybackEase = animPlaybackEase ? parseEase(animPlaybackEase) : null;
    const hasSpring = !isUnd(/** @type {Spring} */(animEase).ease);
    const tEasing = hasSpring ? /** @type {Spring} */(animEase).ease : setValue(ease, parsedAnimPlaybackEase ? 'linear' : animDefaults.ease);
    const tDuration = hasSpring ? /** @type {Spring} */(animEase).settlingDuration : setValue(duration, animDefaults.duration);
    const tDelay = setValue(delay, animDefaults.delay);
    const tModifier = modifier || animDefaults.modifier;
    // If no composition is defined and the targets length is high (>= 1000) set the composition to 'none' (0) for faster tween creation
    const tComposition = isUnd(composition) && targetsLength >= K ? compositionTypes.none : !isUnd(composition) ? composition : animDefaults.composition;
    // const absoluteOffsetTime = this._offset;
    const absoluteOffsetTime = this._offset + (parent ? parent._offset : 0);
    // This allows targeting the current animation in the spring onComplete callback
    if (hasSpring) /** @type {Spring} */(animEase).parent = this;

    let iterationDuration = NaN;
    let iterationDelay = NaN;
    let animationAnimationLength = 0;
    let shouldTriggerRender = 0;

    for (let targetIndex = 0; targetIndex < targetsLength; targetIndex++) {

      const target = parsedTargets[targetIndex];
      const ti = index || targetIndex;
      const tl = length || targetsLength;

      let lastTransformGroupIndex = NaN;
      let lastTransformGroupLength = NaN;

      for (let p in params) {

        if (isKey(p)) {

          const tweenType = getTweenType(target, p);

          const propName = sanitizePropertyName(p, target, tweenType);

          let propValue = params[p];

          const isPropValueArray = isArr(propValue);

          if (fastSet && !isPropValueArray) {
            ctx.fastSetValuesArray[0] = propValue;
            ctx.fastSetValuesArray[1] = propValue;
            propValue = ctx.fastSetValuesArray;
          }

          let keyframes;
          // TODO: Allow nested keyframes inside ObjectValue value (prop: { to: [.5, 1, .75, 2, 3] })
          // Normalize property values to valid keyframe syntax:
          // [x, y] to [{to: [x, y]}] or {to: x} to [{to: x}] or keep keys syntax [{}, {}, {}...]
          // const keyframes = isArr(propValue) ? propValue.length === 2 && !isObj(propValue[0]) ? [{ to: propValue }] : propValue : [propValue];
          if (isPropValueArray) {
            const arrayLength = /** @type {Array} */(propValue).length;
            const isNotObjectValue = !isObj(propValue[0]);
            // Convert [x, y] to [{to: [x, y]}]
            if (arrayLength === 2 && isNotObjectValue) {
              ctx.keyObjectTarget.to = /** @type {TweenParamValue} */(/** @type {unknown} */(propValue));
              ctx.keyframesTargetArray[0] = ctx.keyObjectTarget;
              keyframes = ctx.keyframesTargetArray;
            // Convert [x, y, z] to [[x, y], z]
            } else if (arrayLength > 2 && isNotObjectValue) {
              keyframes = [];
              /** @type {Array.<Number>} */(propValue).forEach((v, i) => {
                if (!i) {
                  ctx.fastSetValuesArray[0] = v;
                } else if (i === 1) {
                  ctx.fastSetValuesArray[1] = v;
                  keyframes.push(ctx.fastSetValuesArray);
                } else {
                  keyframes.push(v);
                }
              });
            } else {
              keyframes = /** @type {Array.<TweenKeyValue>} */(propValue);
            }
          } else {
            ctx.keyframesTargetArray[0] = propValue;
            keyframes = ctx.keyframesTargetArray;
          }

          let siblings = null;
          let prevTween = null;
          let firstTweenChangeStartTime = NaN;
          let lastTweenChangeEndTime = 0;
          let tweenIndex = 0;

          for (let l = keyframes.length; tweenIndex < l; tweenIndex++) {

            const keyframe = keyframes[tweenIndex];
            let key;

            if (isObj(keyframe)) {
              key = keyframe;
            } else {
              ctx.keyObjectTarget.to = /** @type {TweenParamValue} */(keyframe);
              key = ctx.keyObjectTarget;
            }

            ctx.toFunctionStore.func = null;
            ctx.fromFunctionStore.func = null;

            const computedToValue = getFunctionValue(key.to, target, ti, tl, ctx.toFunctionStore);

            let tweenToValue;
            // Allows function based values to return an object syntax value ({to: v})
            if (isObj(computedToValue) && !isUnd(computedToValue.to)) {
              key = computedToValue;
              tweenToValue = computedToValue.to;
            } else {
              tweenToValue = computedToValue;
            }
            const tweenFromValue = getFunctionValue(key.from, target, ti, tl);
            const easeToParse = key.ease || tEasing;

            const easeFunctionResult = getFunctionValue(easeToParse, target, ti, tl);
            const keyEasing = isFnc(easeFunctionResult) || isStr(easeFunctionResult) ? easeFunctionResult : easeToParse;

            const hasSpring = !isUnd(keyEasing) && !isUnd(/** @type {Spring} */(keyEasing).ease);
            const tweenEasing = hasSpring ? /** @type {Spring} */(keyEasing).ease : keyEasing;
            // Calculate default individual keyframe duration by dividing the tl of keyframes
            const tweenDuration = hasSpring ? /** @type {Spring} */(keyEasing).settlingDuration : getFunctionValue(setValue(key.duration, (l > 1 ? getFunctionValue(tDuration, target, ti, tl) / l : tDuration)), target, ti, tl);
            // Default delay value should only be applied to the first tween
            const tweenDelay = getFunctionValue(setValue(key.delay, (!tweenIndex ? tDelay : 0)), target, ti, tl);
            const computedComposition = getFunctionValue(setValue(key.composition, tComposition), target, ti, tl);
            const tweenComposition = isNum(computedComposition) ? computedComposition : compositionTypes[computedComposition];
            // Modifiers are treated differently and don't accept function based value to prevent having to pass a function wrapper
            const tweenModifier = key.modifier || tModifier;
            const hasFromvalue = !isUnd(tweenFromValue);
            const hasToValue = !isUnd(tweenToValue);
            const isFromToArray = isArr(tweenToValue);
            const isFromToValue = isFromToArray || (hasFromvalue && hasToValue);
            const tweenStartTime = prevTween ? lastTweenChangeEndTime + tweenDelay : tweenDelay;
            // Rounding is necessary here to minimize floating point errors when working in seconds
            const absoluteStartTime = round(absoluteOffsetTime + tweenStartTime, 12);

            // Force a onRender callback if the animation contains at least one from value and autoplay is set to false
            if (!shouldTriggerRender && (hasFromvalue || isFromToArray)) shouldTriggerRender = 1;

            let prevSibling = prevTween;

            if (tweenComposition !== compositionTypes.none) {
              if (!siblings) siblings = getTweenSiblings(target, propName);
              let nextSibling = siblings._head;
              // Iterate trough all the next siblings until we find a sibling with an equal or inferior start time
              while (nextSibling && !nextSibling._isOverridden && nextSibling._absoluteStartTime <= absoluteStartTime) {
                prevSibling = nextSibling;
                nextSibling = nextSibling._nextRep;
                // Overrides all the next siblings if the next sibling starts at the same time of after as the new tween start time
                if (nextSibling && nextSibling._absoluteStartTime >= absoluteStartTime) {
                  while (nextSibling) {
                    overrideTween(nextSibling);
                    // This will ends both the current while loop and the upper one once all the next sibllings have been overriden
                    nextSibling = nextSibling._nextRep;
                  }
                }
              }
            }

            // Decompose values
            if (isFromToValue) {
              decomposeRawValue(isFromToArray ? getFunctionValue(tweenToValue[0], target, ti, tl, ctx.fromFunctionStore) : tweenFromValue, ctx.fromTargetObject);
              decomposeRawValue(isFromToArray ? getFunctionValue(tweenToValue[1], target, ti, tl, ctx.toFunctionStore) : tweenToValue, ctx.toTargetObject);
              // Needed to force an inline style registration
              const originalValue = getOriginalAnimatableValue(target, propName, tweenType, ctx.inlineStylesStore);
              if (ctx.fromTargetObject.t === valueTypes.NUMBER) {
                if (prevSibling) {
                  if (prevSibling._valueType === valueTypes.UNIT) {
                    ctx.fromTargetObject.t = valueTypes.UNIT;
                    ctx.fromTargetObject.u = prevSibling._unit;
                  }
                } else {
                  decomposeRawValue(
                    originalValue,
                    ctx.decomposedOriginalValue
                  );
                  if (ctx.decomposedOriginalValue.t === valueTypes.UNIT) {
                    ctx.fromTargetObject.t = valueTypes.UNIT;
                    ctx.fromTargetObject.u = ctx.decomposedOriginalValue.u;
                  }
                }
              }
            } else {
              if (hasToValue) {
                decomposeRawValue(tweenToValue, ctx.toTargetObject);
              } else {
                if (prevTween) {
                  decomposeTweenValue(prevTween, ctx.toTargetObject);
                } else {
                  // No need to get and parse the original value if the tween is part of a timeline and has a previous sibling part of the same timeline
                  decomposeRawValue(parent && prevSibling && prevSibling.parent.parent === parent ? prevSibling._value :
                  getOriginalAnimatableValue(target, propName, tweenType, ctx.inlineStylesStore), ctx.toTargetObject);
                }
              }
              if (hasFromvalue) {
                decomposeRawValue(tweenFromValue, ctx.fromTargetObject);
              } else {
                if (prevTween) {
                  decomposeTweenValue(prevTween, ctx.fromTargetObject);
                } else {
                  decomposeRawValue(parent && prevSibling && prevSibling.parent.parent === parent ? prevSibling._value :
                  // No need to get and parse the original value if the tween is part of a timeline and has a previous sibling part of the same timeline
                  getOriginalAnimatableValue(target, propName, tweenType, ctx.inlineStylesStore), ctx.fromTargetObject);
                }
              }
            }

            // Apply operators
            if (ctx.fromTargetObject.o) {
              ctx.fromTargetObject.n = getRelativeValue(
                !prevSibling ? decomposeRawValue(
                  getOriginalAnimatableValue(target, propName, tweenType, ctx.inlineStylesStore),
                  ctx.decomposedOriginalValue
                ).n : prevSibling._toNumber,
                ctx.fromTargetObject.n,
                ctx.fromTargetObject.o
              );
            }

            if (ctx.toTargetObject.o) {
              ctx.toTargetObject.n = getRelativeValue(ctx.fromTargetObject.n, ctx.toTargetObject.n, ctx.toTargetObject.o);
            }

            // Values omogenisation in cases of type difference between "from" and "to"
            if (ctx.fromTargetObject.t !== ctx.toTargetObject.t) {
              if (ctx.fromTargetObject.t === valueTypes.COMPLEX || ctx.toTargetObject.t === valueTypes.COMPLEX) {
                const complexValue = ctx.fromTargetObject.t === valueTypes.COMPLEX ? ctx.fromTargetObject : ctx.toTargetObject;
                const notComplexValue = ctx.fromTargetObject.t === valueTypes.COMPLEX ? ctx.toTargetObject : ctx.fromTargetObject;
                notComplexValue.t = valueTypes.COMPLEX;
                notComplexValue.s = cloneArray(complexValue.s);
                notComplexValue.d = complexValue.d.map(() => notComplexValue.n);
              } else if (ctx.fromTargetObject.t === valueTypes.UNIT || ctx.toTargetObject.t === valueTypes.UNIT) {
                const unitValue = ctx.fromTargetObject.t === valueTypes.UNIT ? ctx.fromTargetObject : ctx.toTargetObject;
                const notUnitValue = ctx.fromTargetObject.t === valueTypes.UNIT ? ctx.toTargetObject : ctx.fromTargetObject;
                notUnitValue.t = valueTypes.UNIT;
                notUnitValue.u = unitValue.u;
              } else if (ctx.fromTargetObject.t === valueTypes.COLOR || ctx.toTargetObject.t === valueTypes.COLOR) {
                const colorValue = ctx.fromTargetObject.t === valueTypes.COLOR ? ctx.fromTargetObject : ctx.toTargetObject;
                const notColorValue = ctx.fromTargetObject.t === valueTypes.COLOR ? ctx.toTargetObject : ctx.fromTargetObject;
                notColorValue.t = valueTypes.COLOR;
                notColorValue.s = colorValue.s;
                notColorValue.d = [0, 0, 0, 1];
              }
            }

            // Unit conversion
            if (ctx.fromTargetObject.u !== ctx.toTargetObject.u) {
              let valueToConvert = ctx.toTargetObject.u ? ctx.fromTargetObject : ctx.toTargetObject;
              valueToConvert = convertValueUnit(/** @type {DOMTarget} */(target), valueToConvert, ctx.toTargetObject.u ? ctx.toTargetObject.u : ctx.fromTargetObject.u, false);
              // TODO:
              // convertValueUnit(target, to.u ? from : to, to.u ? to.u : from.u);
            }

            // Fill in non existing complex values
            if (ctx.toTargetObject.d && ctx.fromTargetObject.d && (ctx.toTargetObject.d.length !== ctx.fromTargetObject.d.length)) {
              const longestValue = ctx.fromTargetObject.d.length > ctx.toTargetObject.d.length ? ctx.fromTargetObject : ctx.toTargetObject;
              const shortestValue = longestValue === ctx.fromTargetObject ? ctx.toTargetObject : ctx.fromTargetObject;
              // TODO: Check if n should be used instead of 0 for default complex values
              shortestValue.d = longestValue.d.map((/** @type {Number} */_, /** @type {Number} */i) => isUnd(shortestValue.d[i]) ? 0 : shortestValue.d[i]);
              shortestValue.s = cloneArray(longestValue.s);
            }

            // Tween factory

            // Rounding is necessary here to minimize floating point errors when working in seconds
            const tweenUpdateDuration = round(+tweenDuration || minValue, 12);

            // Copy the value of the iniline style if it exist and imediatly nullify it to prevents false positive on other targets
            let inlineValue = ctx.inlineStylesStore[propName];
            if (!isNil(inlineValue)) ctx.inlineStylesStore[propName] = null;

            /** @type {Tween} */
            const tween = {
              parent: this,
              id: tweenId++,
              property: propName,
              target: target,
              _value: null,
              _toFunc: ctx.toFunctionStore.func,
              _fromFunc: ctx.fromFunctionStore.func,
              _ease: parseEase(tweenEasing),
              _fromNumbers: cloneArray(ctx.fromTargetObject.d),
              _toNumbers: cloneArray(ctx.toTargetObject.d),
              _strings: cloneArray(ctx.toTargetObject.s),
              _fromNumber: ctx.fromTargetObject.n,
              _toNumber: ctx.toTargetObject.n,
              _numbers: cloneArray(ctx.fromTargetObject.d), // For additive tween and animatables
              _number: ctx.fromTargetObject.n, // For additive tween and animatables
              _unit: ctx.toTargetObject.u,
              _modifier: tweenModifier,
              _currentTime: 0,
              _startTime: tweenStartTime,
              _delay: +tweenDelay,
              _updateDuration: tweenUpdateDuration,
              _changeDuration: tweenUpdateDuration,
              _absoluteStartTime: absoluteStartTime,
              // NOTE: Investigate bit packing to stores ENUM / BOOL
              _tweenType: tweenType,
              _valueType: ctx.toTargetObject.t,
              _composition: tweenComposition,
              _isOverlapped: 0,
              _isOverridden: 0,
              _renderTransforms: 0,
              _inlineValue: inlineValue,
              _prevRep: null, // For replaced tween
              _nextRep: null, // For replaced tween
              _prevAdd: null, // For additive tween
              _nextAdd: null, // For additive tween
              _prev: null,
              _next: null,
            }

            if (tweenComposition !== compositionTypes.none) {
              composeTween(tween, siblings);
            }

            if (isNaN(firstTweenChangeStartTime)) {
              firstTweenChangeStartTime = tween._startTime;
            }
            // Rounding is necessary here to minimize floating point errors when working in seconds
            lastTweenChangeEndTime = round(tweenStartTime + tweenUpdateDuration, 12);
            prevTween = tween;
            animationAnimationLength++;

            addChild(this, tween);

          }

          // Update animation timings with the added tweens properties

          if (isNaN(iterationDelay) || firstTweenChangeStartTime < iterationDelay) {
            iterationDelay = firstTweenChangeStartTime;
          }

          if (isNaN(iterationDuration) || lastTweenChangeEndTime > iterationDuration) {
            iterationDuration = lastTweenChangeEndTime;
          }

          // TODO: Find a way to inline tween._renderTransforms = 1 here
          if (tweenType === tweenTypes.TRANSFORM) {
            lastTransformGroupIndex = animationAnimationLength - tweenIndex;
            lastTransformGroupLength = animationAnimationLength;
          }

        }

      }

      // Set _renderTransforms to last transform property to correctly render the transforms list
      if (!isNaN(lastTransformGroupIndex)) {
        let i = 0;
        forEachChildren(this, (/** @type {Tween} */tween) => {
          if (i >= lastTransformGroupIndex && i < lastTransformGroupLength) {
            tween._renderTransforms = 1;
            if (tween._composition === compositionTypes.blend) {
              forEachChildren(additive.animation, (/** @type {Tween} */additiveTween) => {
                if (additiveTween.id === tween.id) {
                  additiveTween._renderTransforms = 1;
                }
              });
            }
          }
          i++;
        });
      }

    }

    if (!targetsLength) {
      console.warn(`No target found. Make sure the element you're trying to animate is accessible before creating your animation.`);
    }

    if (iterationDelay) {
      forEachChildren(this, (/** @type {Tween} */tween) => {
        // If (startTime - delay) equals 0, this means the tween is at the begining of the animation so we need to trim the delay too
        if (!(tween._startTime - tween._delay)) {
          tween._delay -= iterationDelay;
        }
        tween._startTime -= iterationDelay;
      });
      iterationDuration -= iterationDelay;
    } else {
      iterationDelay = 0;
    }

    // Prevents iterationDuration to be NaN if no valid animatable props have been provided
    // Prevents _iterationCount to be NaN if no valid animatable props have been provided
    if (!iterationDuration) {
      iterationDuration = minValue;
      this.iterationCount = 0;
    }
    /** @type {TargetsArray} */
    this.targets = parsedTargets;
    /** @type {String|Number} */
    this.id = !isUnd(id) ? id : JSAnimationId;
    /** @type {Number} */
    this.duration = iterationDuration === minValue ? minValue : clampInfinity(((iterationDuration + this._loopDelay) * this.iterationCount) - this._loopDelay) || minValue;
    /** @type {Callback<this>} */
    this.onRender = onRender || animDefaults.onRender;
    /** @type {EasingFunction} */
    this._ease = parsedAnimPlaybackEase;
    /** @type {Number} */
    this._delay = iterationDelay;
    // NOTE: I'm keeping delay values separated from offsets in timelines because delays can override previous tweens and it could be confusing to debug a timeline with overridden tweens and no associated visible delays.
    // this._delay = parent ? 0 : iterationDelay;
    // this._offset += parent ? iterationDelay : 0;
    /** @type {Number} */
    this.iterationDuration = iterationDuration;

    if (!this._autoplay && shouldTriggerRender) this.onRender(this);
  }

  /**
   * @param  {Number} newDuration
   * @return {this}
   */
  stretch(newDuration) {
    const currentDuration = this.duration;
    if (currentDuration === normalizeTime(newDuration)) return this;
    const timeScale = newDuration / currentDuration;
    // NOTE: Find a better way to handle the stretch of an animation after stretch = 0
    forEachChildren(this, (/** @type {Tween} */tween) => {
      // Rounding is necessary here to minimize floating point errors
      tween._updateDuration = normalizeTime(tween._updateDuration * timeScale);
      tween._changeDuration = normalizeTime(tween._changeDuration * timeScale);
      tween._currentTime *= timeScale;
      tween._startTime *= timeScale;
      tween._absoluteStartTime *= timeScale;
    });
    return super.stretch(newDuration);
  }

  /**
   * @return {this}
   */
  refresh() {
    const ctx = createAnimationContext();
    forEachChildren(this, (/** @type {Tween} */tween) => {
      const toFunc = tween._toFunc;
      const fromFunc = tween._fromFunc;
      if (toFunc || fromFunc) {
        if (fromFunc) {
          decomposeRawValue(fromFunc(), ctx.fromTargetObject);
          if (ctx.fromTargetObject.u !== tween._unit && tween.target[isDomSymbol]) {
            convertValueUnit(/** @type {DOMTarget} */(tween.target), ctx.fromTargetObject, tween._unit, true);
          }
          tween._fromNumbers = cloneArray(ctx.fromTargetObject.d);
          tween._fromNumber = ctx.fromTargetObject.n;
        } else if (toFunc) {
          // When only toFunc exists, get from value from target
          decomposeRawValue(getOriginalAnimatableValue(tween.target, tween.property, tween._tweenType), ctx.decomposedOriginalValue);
          tween._fromNumbers = cloneArray(ctx.decomposedOriginalValue.d);
          tween._fromNumber = ctx.decomposedOriginalValue.n;
        }
        if (toFunc) {
          decomposeRawValue(toFunc(), ctx.toTargetObject);
          tween._toNumbers = cloneArray(ctx.toTargetObject.d);
          tween._strings = cloneArray(ctx.toTargetObject.s);
          // Make sure to apply relative operators https://github.com/juliangarnier/anime/issues/1025
          tween._toNumber = ctx.toTargetObject.o ? getRelativeValue(tween._fromNumber, ctx.toTargetObject.n, ctx.toTargetObject.o) : ctx.toTargetObject.n;
        }
      }
    });
    // This forces setter animations to render once
    if (this.duration === minValue) this.restart();
    return this;
  }

  /**
   * Cancel the animation and revert all the values affected by this animation to their original state
   * @return {this}
   */
  revert() {
    super.revert();
    return cleanInlineStyles(this);
  }

  /**
   * @typedef {this & {then: null}} ResolvedJSAnimation
   */

  /**
   * @param  {Callback<ResolvedJSAnimation>} [callback]
   * @return Promise<this>
   */
  then(callback) {
    return super.then(callback);
  }

}

/**
 * @param {TargetsParam} targets
 * @param {AnimationParams} parameters
 * @return {JSAnimation}
 */
export const animate = (targets, parameters) => new JSAnimation(targets, parameters, null, 0, false).init();

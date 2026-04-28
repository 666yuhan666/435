import {
  expect,
} from '../utils.js';

import {
  animate,
  engine,
  createTimer,
  createTimeline,
  utils,
} from '../../dist/modules/index.js';

suite('Stability Regression Tests', () => {

  suite('Progress Calculation (高频暂停恢复)', () => {

    test('pause() should update _currentTime before setting paused=true', () => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      const animation = animate($target, {
        x: 100,
        duration: 100,
        autoplay: false,
      });

      animation.seek(50);
      const currentTimeBeforePause = animation.currentTime;
      expect(currentTimeBeforePause).to.equal(50);

      animation.pause();
      const currentTimeAfterPause = animation.currentTime;
      expect(currentTimeAfterPause).to.equal(50);

      animation.resume();
      animation.pause();
      expect(animation.currentTime).to.equal(50);
    });

    test('rapid pause/resume should not cause time jump', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      let lastCurrentTime = 0;
      const animation = animate($target, {
        x: 100,
        duration: 200,
        ease: 'linear',
        onUpdate: self => {
          lastCurrentTime = self.currentTime;
        }
      });

      setTimeout(() => {
        animation.pause();
        const timeAfterPause = animation.currentTime;
        expect(timeAfterPause).to.be.above(0);
        expect(timeAfterPause).to.be.below(100);

        animation.resume();
        animation.pause();
        const timeAfterRapidToggle = animation.currentTime;
        
        expect(timeAfterRapidToggle).to.be.at.least(timeAfterPause);
        expect(timeAfterRapidToggle - timeAfterPause).to.be.below(50);
        
        animation.cancel();
        resolve();
      }, 50);
    });

    test('resume() after pause() should continue from correct time', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      let times = [];
      const animation = animate($target, {
        x: 100,
        duration: 200,
        ease: 'linear',
        onUpdate: self => {
          times.push(self.currentTime);
        }
      });

      setTimeout(() => {
        animation.pause();
        const pausedTime = animation.currentTime;
        expect(pausedTime).to.be.above(0);

        setTimeout(() => {
          animation.resume();
          
          setTimeout(() => {
            expect(animation.currentTime).to.be.above(pausedTime);
            animation.cancel();
            resolve();
          }, 50);
        }, 50);
      }, 50);
    });

  });

  suite('Instance Isolation (并发实例)', () => {

    test('concurrent animations should have correct _offset', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      const animation1 = animate($target, {
        x: 100,
        duration: 50,
        ease: 'linear',
      });

      setTimeout(() => {
        const animation2 = animate($target, {
          y: 100,
          duration: 50,
          ease: 'linear',
        });

        expect(animation2._offset).to.be.above(animation1._offset);
        expect(animation2._offset - animation1._offset).to.be.above(10);
        
        animation1.cancel();
        animation2.cancel();
        resolve();
      }, 50);
    });

    test('concurrent animations should not inherit progress', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      let anim1Complete = false;
      let anim2Complete = false;
      let anim2StartTime = 0;

      const animation1 = animate($target, {
        x: 100,
        duration: 100,
        ease: 'linear',
        onComplete: () => {
          anim1Complete = true;
        }
      });

      setTimeout(() => {
        const animation2 = animate($target, {
          y: 100,
          duration: 100,
          ease: 'linear',
          onBegin: () => {
            anim2StartTime = Date.now();
          },
          onComplete: () => {
            anim2Complete = true;
          }
        });

        expect(animation2.currentTime).to.equal(0);
        expect(animation2.began).to.equal(false);
        expect(animation2.completed).to.equal(false);

        setTimeout(() => {
          expect(anim1Complete).to.equal(true);
          
          setTimeout(() => {
            expect(anim2Complete).to.equal(true);
            animation2.cancel();
            resolve();
          }, 100);
        }, 75);
      }, 50);
    });

    test('multiple concurrent animations should have independent progress', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      const [ $target2 ] = utils.$('.target-class');
      
      let anim1Progress = 0;
      let anim2Progress = 0;

      const animation1 = animate($target, {
        x: 100,
        duration: 300,
        ease: 'linear',
        onUpdate: self => {
          anim1Progress = self.progress;
        }
      });

      setTimeout(() => {
        const anim1ProgressAtAnim2Start = anim1Progress;
        expect(anim1ProgressAtAnim2Start).to.be.above(0);

        const animation2 = animate($target2, {
          y: 100,
          duration: 300,
          ease: 'linear',
          onUpdate: self => {
            anim2Progress = self.progress;
          }
        });

        expect(anim2Progress).to.equal(0);
        expect(animation2.currentTime).to.equal(0);
        expect(animation2.began).to.equal(false);

        setTimeout(() => {
          expect(anim1Progress).to.be.above(anim1ProgressAtAnim2Start);
          expect(anim2Progress).to.be.above(0);
          expect(anim2Progress).to.be.below(0.5);
          
          animation1.cancel();
          animation2.cancel();
          resolve();
        }, 50);
      }, 100);
    });

  });

  suite('Callback Timing (回调触发)', () => {

    test('onComplete should trigger after render is complete', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      let onCompleteCalled = false;
      let onCompleteProgress = 0;
      let lastRenderProgress = 0;

      const animation = animate($target, {
        x: 100,
        duration: 50,
        ease: 'linear',
        onRender: self => {
          lastRenderProgress = self.progress;
        },
        onComplete: self => {
          onCompleteCalled = true;
          onCompleteProgress = self.progress;
        }
      });

      setTimeout(() => {
        expect(onCompleteCalled).to.equal(true);
        expect(onCompleteProgress).to.equal(1);
        expect(lastRenderProgress).to.equal(1);
        expect(animation.currentTime).to.equal(50);
        resolve();
      }, 100);
    });

    test('onBegin should trigger after delay and before first render', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      let onBeginCalled = false;
      let onBeginTime = 0;
      let renderCount = 0;

      const animation = animate($target, {
        x: 100,
        delay: 50,
        duration: 50,
        ease: 'linear',
        onBegin: self => {
          onBeginCalled = true;
          onBeginTime = self.currentTime;
        },
        onRender: () => {
          renderCount++;
        }
      });

      setTimeout(() => {
        expect(onBeginCalled).to.equal(false);
        expect(renderCount).to.equal(0);
      }, 25);

      setTimeout(() => {
        expect(onBeginCalled).to.equal(true);
        expect(onBeginTime).to.be.above(0);
        animation.cancel();
        resolve();
      }, 100);
    });

    test('callback order: onBegin -> onBeforeUpdate -> onRender -> onUpdate -> onComplete', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      const callbacks = [];

      const animation = animate($target, {
        x: 100,
        duration: 50,
        ease: 'linear',
        onBegin: () => callbacks.push('begin'),
        onBeforeUpdate: () => callbacks.push('beforeUpdate'),
        onRender: () => callbacks.push('render'),
        onUpdate: () => callbacks.push('update'),
        onComplete: () => {
          callbacks.push('complete');
          
          expect(callbacks.indexOf('begin')).to.be.below(callbacks.indexOf('beforeUpdate'));
          expect(callbacks.indexOf('beforeUpdate')).to.be.below(callbacks.indexOf('render'));
          expect(callbacks.indexOf('render')).to.be.below(callbacks.indexOf('update'));
          expect(callbacks.lastIndexOf('update')).to.be.below(callbacks.indexOf('complete'));
          
          resolve();
        }
      });
    });

    test('onPause should trigger with currentTime', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      let pauseTime = -1;
      const animation = animate($target, {
        x: 100,
        duration: 100,
        ease: 'linear',
        onPause: self => {
          pauseTime = self.currentTime;
        }
      });

      setTimeout(() => {
        const currentTimeBeforePause = animation.currentTime;
        expect(currentTimeBeforePause).to.be.above(0);
        
        animation.pause();
        
        expect(pauseTime).to.equal(currentTimeBeforePause);
        animation.cancel();
        resolve();
      }, 50);
    });

  });

  suite('Low Frame Rate Environment (低帧率环境)', () => {

    test('large time delta should not cause incorrect progress', resolve => {
      const $target = /** @type {HTMLElement} */(document.querySelector('#target-id'));
      
      engine.useDefaultMainLoop = false;

      let progressValues = [];
      
      const animation = animate($target, {
        x: 100,
        duration: 1000,
        ease: 'linear',
        onUpdate: self => {
          progressValues.push(self.progress);
        }
      });

      let step = 0;
      function manualTick() {
        step++;
        if (step === 1) {
          engine.update();
          setTimeout(manualTick, 100);
        } else if (step === 2) {
          engine.update();
          
          expect(animation.progress).to.be.above(0);
          expect(animation.progress).to.be.below(0.5);
          
          engine.useDefaultMainLoop = true;
          animation.cancel();
          resolve();
        }
      }
      
      manualTick();
    });

  });

});

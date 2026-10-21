 
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

const NO_MONITORING = 'no monitoring'
const VIOLATION_TRASH = 'Violation threshold'
const WARNING_TRASH = 'Warning threshold'

export const EndoflifePolicy = new SimpleSchema({
  enabled: {
    type: Boolean,
    optional: true
  },
  warningThreshold: {
    label: WARNING_TRASH,
    type: Number,
    max: 24,
    min: 0,
    custom: function () {
      if (this.value !== 0 && this.value < this.field('violationThreshold').value) {
        return 'invalidConfiguration';
      }
    },
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower',
          tooltips: {
            to(value) {
              return value === 0 ? NO_MONITORING : `${Math.round(value)}m`;
            }
          }
        },
        noUiSlider_pipsOptions: {
          mode: 'steps',
          density: 3,
          format: {
            to(value) {
              if (value % 3 !== 0) return '';
              // 'off', not 'no monitoring': the long label ran into the 3m tick.
              return value === 0 ? 'off' : `${value}m`;
            }
          }
        }
      }
    }
  },
  violationThreshold: {
    label: VIOLATION_TRASH,
    type: Number,
    max: 24,
    min: 0,
    custom: function () {
      if (this.field('warningThreshold').value !== 0 && this.value > this.field('warningThreshold').value) {
        return 'invalidConfiguration';
      }
    },
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower',
          tooltips: {
            to(value) {
              return value === 0 ? NO_MONITORING : `${Math.round(value)}m`;
            }
          }
        },
        noUiSlider_pipsOptions: {
          mode: 'steps',
          density: 3,
          format: {
            to(value) {
              if (value % 3 !== 0) return '';
              // 'off', not 'no monitoring': the long label ran into the 3m tick.
              return value === 0 ? 'off' : `${value}m`;
            }
          }
        }
      }
    }
  }
});

EndoflifePolicy.messages({
  invalidConfiguration: '\'Warning threshold\' must not be lower than \'Violation threshold\''
});

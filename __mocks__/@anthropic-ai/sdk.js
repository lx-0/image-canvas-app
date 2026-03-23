'use strict';

function MockAnthropic() {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: '<commands>[{"action":"grayscale"}]</commands>\nConverted to grayscale.' }],
      }),
      stream: () => {
        const handlers = {};
        const obj = {
          on(event, cb) {
            handlers[event] = cb;
            if (event === 'text') cb('Hello from stream');
            return obj;
          },
          finalMessage: async () => ({}),
        };
        return obj;
      },
    },
  };
}

module.exports = MockAnthropic;
module.exports.default = MockAnthropic;

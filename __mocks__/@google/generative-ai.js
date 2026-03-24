'use strict';

class MockGoogleGenerativeAI {
  constructor() {}

  getGenerativeModel() {
    return {
      generateContent: async () => ({
        response: {
          text: () => '<commands>[{"action":"grayscale"}]</commands>\nConverted to grayscale.',
        },
      }),
      generateContentStream: async () => ({
        stream: (async function* () {
          yield { text: () => 'Hello from stream' };
        })(),
      }),
    };
  }
}

module.exports = { GoogleGenerativeAI: MockGoogleGenerativeAI };

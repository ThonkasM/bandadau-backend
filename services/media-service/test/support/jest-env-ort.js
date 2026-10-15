/* eslint-disable @typescript-eslint/no-require-imports */
// onnxruntime-node checks `data instanceof Float32Array` against the OUTER realm; Jest's vm sandbox has its own typed arrays.
const NodeEnvironment = require('jest-environment-node').TestEnvironment;
module.exports = class OrtNodeEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.Float32Array = globalThis.Float32Array;
  }
};

declare module '@echogarden/rnnoise-wasm' {
  type RnnoiseWasmFactory = () => Promise<unknown>;
  const factory: RnnoiseWasmFactory;
  export default factory;
}

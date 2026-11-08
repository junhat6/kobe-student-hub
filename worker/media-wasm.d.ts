declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
// Wrangler supplies a compiled module; the upstream package describes raw Wasm exports instead.
declare module '@jsquash/png/codec/pkg/squoosh_png_bg.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

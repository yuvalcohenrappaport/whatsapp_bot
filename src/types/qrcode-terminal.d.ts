declare module 'qrcode-terminal' {
  interface QRCodeOptions {
    small?: boolean;
  }

  function generate(text: string, opts?: QRCodeOptions, cb?: (qrcode: string) => void): void;
  function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void;

  export { generate, setErrorLevel };
  export default { generate, setErrorLevel };
}

declare module 'tar-stream' {
  const tar: {
    extract(): {
      on(event: string, handler: (...args: any[]) => void): void;
      end(buffer: Buffer): void;
    };
  };

  export default tar;
}

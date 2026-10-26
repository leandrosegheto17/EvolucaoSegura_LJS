// Tipos mínimos do pdfmake 0.3 (build de navegador), só o que o app usa.
declare module 'pdfmake/build/pdfmake' {
  interface PdfDoc {
    getBlob(): Promise<Blob>;
  }
  interface PdfMake {
    addVirtualFileSystem(vfs: Record<string, string>): void;
    addFonts(fonts: Record<string, Record<string, string>>): void;
    createPdf(definicao: object): PdfDoc;
  }
  const pdfMake: PdfMake;
  export default pdfMake;
}
declare module 'pdfmake/build/vfs_fonts' {
  const vfs: Record<string, string>;
  export default vfs;
}

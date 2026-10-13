export type FileContentType = 'image' | 'pdf' | 'text' | 'archive' | 'code' | 'binary';

export interface ExtractedContent {
  type: FileContentType;
  fileName: string;
  fileExtension: string;
  fileSize: number;
  mimeType: string;
  createdDate: Date;
  textSnippet?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

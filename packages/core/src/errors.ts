export type ErrorCode =
  | "DOC_NOT_FOUND"
  | "NODE_NOT_FOUND"
  | "INVALID_PARENT"
  | "INVALID_COLOR"
  | "INVALID_PATH"
  | "LIMIT_EXCEEDED"
  | "PERMISSION_DENIED";

/** What an Agent sees for a failed call: enough to fix the call without a stack trace. */
export interface ErrorData {
  code: ErrorCode;
  message: string;
  hint: string;
  path?: string;
}

export class ZibelError extends Error {
  constructor(readonly data: ErrorData) {
    super(data.message);
    this.name = "ZibelError";
  }
}

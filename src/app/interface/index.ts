import { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
      files?:
        | { [fieldname: string]: Express.Multer.File[] }
        | Express.Multer.File[]
        | undefined;
    }
  }
}

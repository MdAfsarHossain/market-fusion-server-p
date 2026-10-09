import { S3Client } from "@aws-sdk/client-s3";
import config from "../../config";

export const s3Client = new S3Client({
  forcePathStyle: true,
  region: config.S3.region,
  endpoint: config.S3.endpoint, //by default aws
  credentials: {
    accessKeyId: config.S3.accessKeyId as string,
    secretAccessKey: config.S3.secretAccessKey as string,
  },
});

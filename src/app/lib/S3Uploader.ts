import path from "path";
import fs from "fs/promises";
import {
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import config from "../../config";
import { s3Client } from "./S3Client";
import { removeFile } from "../utils/removeFile";

// **Multipart Upload to DigitalOcean Spaces**
// THIS CODE IS WORKING for disk storage
// const uploadToS3 = async (
//   file: Express.Multer.File,
//   folder?: string,
// ): Promise<{ Location: string; Bucket: string; Key: string }> => {
//   if (!file) {
//     throw new Error("File is required for uploading.");
//   }
//   if (!file.path || !file.mimetype || !file.originalname) {
//     throw new Error("Invalid file data provided.");
//   }

//   const Bucket = config.S3.bucketName || "";
//   const parsedPath = path.parse(file.originalname);
//   const sanitizedName = parsedPath.name
//     .replace(/[^a-zA-Z0-9]/g, "-") // Replace non-alphanumeric with dashes
//     .replace(/-+/g, "-") // Replace multiple dashes with a single dash
//     .replace(/^-+|-+$/g, ""); // Remove leading and trailing dashes
//   const newFilename = `${sanitizedName}-${Date.now()}${parsedPath.ext}`;

//   const Key = folder
//     ? `images/${folder}/${newFilename}`
//     : `images/${newFilename}`;

//   try {
//     const fileBuffer = await fs.readFile(file.path);
//     const command = new PutObjectCommand({
//       Bucket: config.S3.bucketName,
//       Key,
//       Body: fileBuffer,
//       // ACL: "public-read",
//       ContentType: file.mimetype,
//     });

//     const uploadResult = await s3Client.send(command);
//     // const { UploadId } = await s3Client.send(createMultipartUpload);

//     if (!uploadResult) {
//       throw new Error("Failed to initiate multipart upload.");
//     }
//     // Remove local file after successful upload
//     await removeFile(file.path);
//     // return {
//     //   // Location: `${config.S3.endpoint}/${Bucket}/${Key}`,
//     //   //  Location: `https://${process.env.DO_SPACE_BUCKET}.nyc3.digitaloceanspaces.com/${file?.key}`,
//     //   Location: `https://${process.env.S3_BUCKET_NAME}.nyc3.digitaloceanspaces.com/${Key}`,
//     //   // Location: `https://s3.sa-east-1.amazonaws.com/${Bucket}/${Key}`,
//     //   //  Location:`https://${Bucket}.s3.amazonaws.com/${Key}`,
//     //   Bucket,
//     //   Key,
//     // };

//     // Correct URL generation based on your S3 provider
//     let locationUrl: string;

//     if (config.S3.endpoint?.includes("supabase.co")) {
//       // Supabase public URL format
//       const publicUrlBase = config.S3.endpoint
//         .replace(".storage.supabase.co", ".supabase.co")
//         .replace("/storage/v1/s3", "/storage/v1/object/public");
//       locationUrl = `${publicUrlBase}/${Bucket}/${Key}`;
//     } else if (config.S3.endpoint && !config.S3.endpoint.includes("amazonaws.com")) {
//       // Custom endpoint (like DigitalOcean Spaces)
//       locationUrl = `${config.S3.endpoint}/${Bucket}/${Key}`;
//     } else {
//       // AWS S3 URL format (virtual hosted style)
//       locationUrl = `https://${Bucket}.s3.${config.S3.region}.amazonaws.com/${Key}`;
//     }

//     return {
//       Location: locationUrl,
//       Bucket,
//       Key,
//     };
//   } catch (error) {
//     console.error("Error in S3 upload:", error);

//     // Clean up local file on error too
//     try {
//       await removeFile(file.path);
//     } catch (cleanupError) {
//       console.error("Error cleaning up file:", cleanupError);
//     }

//     throw error;
//   }
// };

// THis code for file buffer
const uploadToS3 = async (
  file: Express.Multer.File,
  folder?: string,
): Promise<{ Location: string; Bucket: string; Key: string }> => {
  if (!file) {
    throw new Error("File is required for uploading.");
  }

  // ✅ FIX: Check for buffer instead of path (memory storage vs disk storage)
  if (!file.buffer || !file.mimetype || !file.originalname) {
    throw new Error("Invalid file data provided.");
  }

  const Bucket = config.S3.bucketName || "";
  const parsedPath = path.parse(file.originalname);
  const sanitizedName = parsedPath.name
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const newFilename = `${sanitizedName}-${Date.now()}${parsedPath.ext}`;

  const Key = folder
    ? `images/${folder}/${newFilename}`
    : `images/${newFilename}`;

  try {
    // ✅ FIX: Use file.buffer directly instead of reading from disk
    const fileBuffer = file.buffer; // No need for fs.readFile!

    const command = new PutObjectCommand({
      Bucket: config.S3.bucketName,
      Key,
      Body: fileBuffer, // Direct buffer upload
      ContentType: file.mimetype,
    });

    const uploadResult = await s3Client.send(command);

    if (!uploadResult) {
      throw new Error("Failed to initiate multipart upload.");
    }

    // ✅ FIX: Don't try to remove file.path (it doesn't exist with memory storage)
    // await removeFile(file.path); // ← COMMENT THIS OUT - no disk file to remove

    let locationUrl: string;

    if (config.S3.endpoint?.includes("supabase.co")) {
      const publicUrlBase = config.S3.endpoint
        .replace(".storage.supabase.co", ".supabase.co")
        .replace("/storage/v1/s3", "/storage/v1/object/public");
      locationUrl = `${publicUrlBase}/${Bucket}/${Key}`;
    } else if (
      config.S3.endpoint &&
      !config.S3.endpoint.includes("amazonaws.com")
    ) {
      locationUrl = `${config.S3.endpoint}/${Bucket}/${Key}`;
    } else {
      locationUrl = `https://${Bucket}.s3.${config.S3.region}.amazonaws.com/${Key}`;
    }

    return {
      Location: locationUrl,
      Bucket,
      Key,
    };
  } catch (error) {
    console.error("Error in S3 upload:", error);

    // ✅ FIX: Don't try to clean up file.path on error either
    // try {
    //   await removeFile(file.path);
    // } catch (cleanupError) {
    //   console.error("Error cleaning up file:", cleanupError);
    // }

    throw error;
  }
};

const uploadBufferToS3 = async (
  buffer: Buffer,
  filename: string,
  mimetype: string,
  folder?: string,
): Promise<{ Location: string; Bucket: string; Key: string }> => {
  const Bucket = config.S3.bucketName || "";
  const parsedPath = path.parse(filename);
  const sanitizedName = parsedPath.name
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const newFilename = `${sanitizedName}-${Date.now()}${parsedPath.ext || ""}`;

  const Key = folder
    ? `images/${folder}/${newFilename}`
    : `images/${newFilename}`;

  try {
    const command = new PutObjectCommand({
      Bucket: config.S3.bucketName,
      Key,
      Body: buffer,
      ContentType: mimetype,
    });

    await s3Client.send(command);

    let locationUrl: string;
    if (config.S3.endpoint?.includes("supabase.co")) {
      const publicUrlBase = config.S3.endpoint
        .replace(".storage.supabase.co", ".supabase.co")
        .replace("/storage/v1/s3", "/storage/v1/object/public");
      locationUrl = `${publicUrlBase}/${Bucket}/${Key}`;
    } else if (
      config.S3.endpoint &&
      !config.S3.endpoint.includes("amazonaws.com")
    ) {
      locationUrl = `${config.S3.endpoint}/${Bucket}/${Key}`;
    } else {
      locationUrl = `https://${Bucket}.s3.${config.S3.region}.amazonaws.com/${Key}`;
    }

    return {
      Location: locationUrl,
      Bucket,
      Key,
    };
  } catch (error) {
    console.error("Error in S3 buffer upload:", error);
    throw error;
  }
};

// **Abort Multipart Upload (Optional)**
const abortMultipartUpload = async (
  Bucket: string,
  Key: string,
  UploadId: string,
) => {
  try {
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket,
      Key,
      UploadId,
    });
    await s3Client.send(abortCommand);
  } catch (error) {
    console.error("Error aborting multipart upload:", error);
  }
};

interface UploadOptions {
  file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  };
  folder?: string;
}

const uploadToS3ForTest = async (options: UploadOptions) => {
  try {
    const { file, folder = "uploads" } = options;

    // ✅ Validate file data
    if (!file || !file.buffer || !file.originalname) {
      throw new Error(
        "Invalid file data provided - missing buffer or filename",
      );
    }

    // Generate unique filename
    const timestamp = Date.now();
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `${folder}/${timestamp}-${safeFileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer, // ✅ Direct buffer upload
      ContentType: file.mimetype,
      ContentLength: file.size,
    });

    await s3Client.send(command);

    // Construct public URL
    // const publicUrl = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_NAME}/${key}`;
    // Supabase public URL format
    // Supabase public URL format
    // const publicUrlBase = config.S3.endpoint
    //   .replace(".storage.supabase.co", ".supabase.co")
    //   .replace("/storage/v1/s3", "/storage/v1/object/public");
    // locationUrl = `${publicUrlBase}/${Bucket}/${Key}`;

    // ✅ Transform S3 URL to Supabase Public URL format
    const supabasePublicUrl = process.env
      .S3_ENDPOINT!.replace(".storage.supabase.co", ".supabase.co")
      .replace("/storage/v1/s3", "/storage/v1/object/public");

    const publicUrl = `${supabasePublicUrl}/${process.env.S3_BUCKET_NAME}/${key}`;

    return {
      success: true,
      url: publicUrl,
      key: key,
    };
  } catch (error) {
    console.error("S3 Upload Error:", error);
    throw error;
  }
};

// Export file uploader methods
export const S3Uploader = {
  abortMultipartUpload,
  uploadToS3,
  uploadBufferToS3,
  uploadToS3ForTest,
};

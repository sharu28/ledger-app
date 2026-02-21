// api/lib/r2.js
// Cloudflare R2 storage client (S3-compatible)

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let _s3;
function getR2Client() {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

export async function uploadToR2(key, body, contentType) {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

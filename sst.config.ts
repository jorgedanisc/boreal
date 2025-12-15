/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "boreal",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      region: "eu-west-1",
    };
  },
  async run() {
    const path = await import("path");
    // 1. Create the S3 Bucket
    const bucket = new sst.aws.Bucket("MyTemplateBucket", {
      access: "public",
    });

    // 2. Upload the file to the bucket using the Pulumi AWS provider
    const templateFilePath = path.join(process.cwd(), "packages/infra/boreal-template.yaml");
    const templateFile = new aws.s3.BucketObject("MyTemplateFile", {
      bucket: bucket.name,
      key: "templates/boreal-template.yaml",
      source: new $util.asset.FileAsset(templateFilePath),
      contentType: "application/x-yaml",
    });

    // 3. Construct the S3 URL to use as your templateUrl
    // Format: https://{bucket}.s3.{region}.amazonaws.com/{key}
    const templateUrl = $interpolate`https://${bucket.name}.s3.${aws.config.region}.amazonaws.com/${templateFile.key}`;

    return {
      TemplateUrl: templateUrl,
    };
  },
});
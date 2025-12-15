export interface AwsRegion {
  code: string;
  name: string;
  flag: string;
}

export const AWS_REGIONS: AwsRegion[] = [
  { code: "us-east-1", name: "US East (N. Virginia)", flag: "🇺🇸" },
  { code: "us-east-2", name: "US East (Ohio)", flag: "🇺🇸" },
  { code: "us-west-1", name: "US West (N. California)", flag: "🇺🇸" },
  { code: "us-west-2", name: "US West (Oregon)", flag: "🇺🇸" },
  { code: "eu-west-1", name: "Europe (Ireland)", flag: "🇮🇪" },
  { code: "eu-west-2", name: "Europe (London)", flag: "🇬🇧" },
  { code: "eu-west-3", name: "Europe (Paris)", flag: "🇫🇷" },
  { code: "eu-central-1", name: "Europe (Frankfurt)", flag: "🇩🇪" },
  { code: "eu-north-1", name: "Europe (Stockholm)", flag: "🇸🇪" },
  { code: "ap-southeast-1", name: "Asia Pacific (Singapore)", flag: "🇸🇬" },
  { code: "ap-southeast-2", name: "Asia Pacific (Sydney)", flag: "🇦🇺" },
  { code: "ap-northeast-1", name: "Asia Pacific (Tokyo)", flag: "🇯🇵" },
  { code: "ap-northeast-2", name: "Asia Pacific (Seoul)", flag: "🇰🇷" },
  { code: "ap-south-1", name: "Asia Pacific (Mumbai)", flag: "🇮🇳" },
  { code: "sa-east-1", name: "South America (São Paulo)", flag: "🇧🇷" },
  { code: "ca-central-1", name: "Canada (Central)", flag: "🇨🇦" },
];

export type StorageTier = "deep-archive" | "instant-retrieval";

export interface StorageTierOption {
  id: StorageTier;
  name: string;
  description: string;
  price: string;
  best: string;
}

export const STORAGE_TIERS: StorageTierOption[] = [
  {
    id: "deep-archive",
    name: "Deep Archive",
    description: "Best for photos you rarely access. Originals take 12-48 hours to retrieve.",
    price: "~$1/TB/month",
    best: "Long-term storage",
  },
  {
    id: "instant-retrieval",
    name: "Instant Retrieval",
    description: "Best for photos you access frequently. Originals are always available.",
    price: "~$4/TB/month",
    best: "Frequent access",
  },
];

export const CLOUDFORMATION_TEMPLATE_URL =
  "https://boreal-production-mytemplatebucketbucket-htstbonh.s3.eu-west-1.amazonaws.com/templates/boreal-template.yaml";

export function getCloudFormationQuickCreateUrl(region: string, tier: StorageTier): string {
  const stackName = "boreal-vault";
  const templateUrl = encodeURIComponent(CLOUDFORMATION_TEMPLATE_URL);
  const storageTier = tier === "deep-archive" ? "DEEP_ARCHIVE" : "GLACIER_IR";

  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?templateURL=${templateUrl}&stackName=${stackName}&param_StorageTier=${storageTier}`;
}

import { customAlphabet } from 'nanoid';

export type Continent = "North America" | "Europe" | "Asia Pacific" | "South America";

export interface AwsRegion {
  code: string;
  city: string;
  continent: Continent;
  countryCode: string;
}

export const AWS_REGIONS: AwsRegion[] = [
  // North America
  { code: "us-east-1", city: "N. Virginia", continent: "North America", countryCode: "US" },
  { code: "us-east-2", city: "Ohio", continent: "North America", countryCode: "US" },
  { code: "us-west-1", city: "N. California", continent: "North America", countryCode: "US" },
  { code: "us-west-2", city: "Oregon", continent: "North America", countryCode: "US" },
  { code: "ca-central-1", city: "Canada", continent: "North America", countryCode: "CA" },
  // Europe
  { code: "eu-west-1", city: "Ireland", continent: "Europe", countryCode: "IE" },
  { code: "eu-west-2", city: "London", continent: "Europe", countryCode: "GB" },
  { code: "eu-west-3", city: "Paris", continent: "Europe", countryCode: "FR" },
  { code: "eu-central-1", city: "Frankfurt", continent: "Europe", countryCode: "DE" },
  { code: "eu-north-1", city: "Stockholm", continent: "Europe", countryCode: "SE" },
  // Asia Pacific
  { code: "ap-southeast-1", city: "Singapore", continent: "Asia Pacific", countryCode: "SG" },
  { code: "ap-southeast-2", city: "Sydney", continent: "Asia Pacific", countryCode: "AU" },
  { code: "ap-northeast-1", city: "Tokyo", continent: "Asia Pacific", countryCode: "JP" },
  { code: "ap-northeast-2", city: "Seoul", continent: "Asia Pacific", countryCode: "KR" },
  { code: "ap-south-1", city: "Mumbai", continent: "Asia Pacific", countryCode: "IN" },
  // South America
  { code: "sa-east-1", city: "São Paulo", continent: "South America", countryCode: "BR" },
];

/** Group regions by continent for display in dropdowns */
export function getRegionsByContinent(): Map<Continent, AwsRegion[]> {
  const grouped = new Map<Continent, AwsRegion[]>();
  const order: Continent[] = ["North America", "Europe", "Asia Pacific", "South America"];

  for (const continent of order) {
    grouped.set(continent, []);
  }

  for (const region of AWS_REGIONS) {
    grouped.get(region.continent)!.push(region);
  }

  return grouped;
}

/** Get display name for a region (city name with code) */
export function getRegionDisplayName(region: AwsRegion): string {
  return `${region.city} (${region.code})`;
}

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

/**
 * Generates a unique stack name with a random suffix.
 * CloudFormation stack names must be unique within an account/region.
 */
function generateUniqueStackName(): string {
  const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);
  const randomSuffix = nanoid(16);
  return `boreal-vault-${randomSuffix}`;
}

export function getCloudFormationQuickCreateUrl(region: string, tier: StorageTier): string {
  const stackName = generateUniqueStackName();
  const templateUrl = encodeURIComponent(CLOUDFORMATION_TEMPLATE_URL);
  const storageTier = tier === "deep-archive" ? "DEEP_ARCHIVE" : "GLACIER_IR";

  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?templateURL=${templateUrl}&stackName=${stackName}&param_StorageTier=${storageTier}`;
}

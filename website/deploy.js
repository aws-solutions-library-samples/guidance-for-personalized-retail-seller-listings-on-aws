/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to execute shell commands and print output
function runCommand(command) {
  console.log(`Executing: ${command}`);
  try {
    const output = execSync(command, { encoding: 'utf8' });
    return output.trim();
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    process.exit(1);
  }
}

// Check if AWS CLI is installed
try {
  runCommand('aws --version');
} catch (error) {
  console.error('AWS CLI is not installed. Please install it first.');
  process.exit(1);
}

// Get the stack prefix and region from the infrastructure config file
let stackPrefix = 'PDG'; // Default prefix
let region = 'us-east-1'; // Default region
const configPath = path.join(__dirname, '..', 'cdk', 'bin', 'config', 'infra.config.json');

try {
  if (fs.existsSync(configPath)) {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    if (config.stackPrefix) {
      stackPrefix = config.stackPrefix;
    } else {
      console.log("Could not find 'stackPrefix' property in config file. Using default prefix 'PDG'.");
    }
    if (config.env && config.env.region) {
      region = config.env.region;
    } else {
      console.log("Could not find 'env.region' property in config file. Using default region 'us-east-1'.");
    }
  } else {
    console.log(`Config file not found: ${configPath}`);
    console.log("Using default prefix 'PDG' and region 'us-east-1'.");
  }
} catch (error) {
  console.error(`Error reading config file: ${error.message}`);
  console.log("Using default prefix 'PDG' and region 'us-east-1'.");
}

console.log(`Using stack prefix: ${stackPrefix}`);
console.log(`Using region: ${region}`);

// Get the S3 bucket name from CloudFormation outputs
const websiteBucketCommand = `aws cloudformation describe-stacks --stack-name ${stackPrefix}-ProductWebsiteStack --query "Stacks[0].Outputs[?OutputKey=='WebsiteAssetsBucketArn'].OutputValue" --output text --region ${region}`;
const websiteBucketArn = runCommand(websiteBucketCommand);

if (!websiteBucketArn) {
  console.error('Could not find the website bucket. Make sure the CloudFormation stack is deployed.');
  process.exit(1);
}

// Extract the bucket name from the ARN
const websiteBucket = websiteBucketArn.split(':').pop();

// Get the CloudFront distribution domain name
const cloudfrontDomainCommand = `aws cloudformation describe-stacks --stack-name ${stackPrefix}-ProductWebsiteStack --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text --region ${region}`;
const cloudfrontUrl = runCommand(cloudfrontDomainCommand);

if (!cloudfrontUrl) {
  console.error('Could not find the CloudFront distribution domain. Make sure the CloudFormation stack is deployed.');
  process.exit(1);
}

const cloudfrontDomain = cloudfrontUrl.replace('https://', '');

// Build the website
console.log('Building the website...');
runCommand('npm run build');

// Deploy to S3
console.log(`Deploying to S3 bucket: ${websiteBucket}`);
runCommand(`aws s3 sync dist/ s3://${websiteBucket} --delete --region ${region}`);

// Create CloudFront invalidation
console.log('Creating invalidation for CloudFront distribution...');
const getDistributionIdCommand = `aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='${cloudfrontDomain}'].Id" --output text`;
const distributionId = runCommand(getDistributionIdCommand);

if (!distributionId) {
  console.error('Could not find the CloudFront distribution ID.');
  process.exit(1);
}

runCommand(`aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`);

console.log('Deployment complete!');
console.log(`Website URL: https://${cloudfrontDomain}`);

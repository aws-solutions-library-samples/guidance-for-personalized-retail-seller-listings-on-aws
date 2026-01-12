# Website Template Integration Guide

This document explains how to integrate this website template with the Product Description Generator system's website generation Lambda function.

## Overview

The website generation Lambda function will:

1. Build the React website template once
2. Deploy the built website to an S3 bucket configured for website hosting
3. Configure CloudFront to serve the website
4. Generate product JSON files from extracted product information
5. Upload these JSON files to a specific path in the S3 bucket

## Dynamic Loading Approach

This template uses a dynamic loading approach where:

1. A single website is deployed to CloudFront
2. Product data is stored as JSON files in S3
3. The website loads product data dynamically based on URL parameters
4. Example URL: `https://example.com/?productId=123456`

This approach has several advantages:
- Only one website needs to be deployed and maintained
- New product data can be added without redeploying the website
- Product data can be updated independently of the website code
- Caching can be optimized for both the website and the product data

## Implementation Steps

### 1. Build the React Template

First, build the React template to generate static HTML, CSS, and JavaScript files:

```bash
cd website-template
npm install
npm run build
```

This will create a `dist` directory with the built files.

### 2. Create the Website Generator Lambda

Create a Lambda function that:

1. Builds the React website (or uses a pre-built version)
2. Uploads the built files to the S3 bucket configured for website hosting
3. Configures CloudFront to serve the website

### 3. Create the Product Data Generator Lambda

Create a Lambda function that:

1. Retrieves the structured product data from the processing pipeline
2. Formats the data according to the expected JSON structure
3. Generates a unique product ID (if not already provided)
4. Uploads the product JSON file to the S3 bucket at `/api/products/{productId}.json`
5. Uploads any product images to the S3 bucket at `/images/{productId}-{imageType}.jpg`
6. Returns the URL to access the product page: `https://example.com/?productId={productId}`

### 4. S3 Bucket Configuration

Configure the S3 bucket for website hosting:

1. Enable website hosting on the bucket
2. Set the index document to `index.html`
3. Set the error document to `index.html` (for SPA routing)
4. Configure CORS to allow requests from the CloudFront domain
5. Set appropriate cache control headers:
   - Long cache times for static assets (JS, CSS)
   - Shorter cache times for product JSON files

### 5. CloudFront Configuration

Configure CloudFront to serve the website:

1. Create a CloudFront distribution with the S3 bucket as the origin
2. Configure cache behaviors:
   - Default: Cache for a long time (e.g., 1 year)
   - `/api/*`: Cache for a shorter time (e.g., 1 hour)
   - `/images/*`: Cache for a long time (e.g., 1 year)
3. Configure error pages to redirect to `index.html` for SPA routing
4. Enable HTTPS

## Product Data Structure

The product data should be formatted as JSON files with the following structure:

```json
{
  "name": "Product Name",
  "brand": "Brand Name",
  "price": "$XXX.XX",
  "rating": 4.5,
  "reviewCount": 123,
  "description": "Detailed product description...",
  "highlights": [
    "Feature highlight 1",
    "Feature highlight 2"
  ],
  "specifications": {
    "Spec Category 1": "Specification value",
    "Spec Category 2": "Specification value"
  },
  "features": [
    {
      "title": "Feature Title",
      "description": "Feature description",
      "icon": "✨"
    }
  ],
  "images": [
    "/images/product-123-main.jpg",
    "/images/product-123-angle.jpg"
  ]
}
```

## Image Handling

1. Product images should be processed and optimized before uploading
2. Images should be uploaded to the `/images/` directory in the S3 bucket
3. Image filenames should include the product ID for uniqueness
4. Multiple sizes of each image can be generated for responsive design

## Error Handling

1. If a product JSON file is not found, the website will display an error message
2. If an image is not found, the website will display a placeholder image
3. The Lambda function should handle errors gracefully and provide meaningful error messages

## Monitoring and Logging

Implement logging in the Lambda functions to track:

1. Website deployment success/failure
2. Product data generation success/failure
3. Processing time
4. Error details
5. S3 upload status

## Testing

Before deploying to production:

1. Test the website with various product data structures
2. Verify all links and images work correctly
3. Test the website on different devices and browsers
4. Validate the HTML and CSS
5. Test with different URL parameters

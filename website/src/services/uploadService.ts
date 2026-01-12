/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import { authService } from './authService';
import * as config from '../config/runtime.config.json';

// Get API URL from environment variables or use the relative path for CloudFront distribution
// When using CloudFront with API Gateway as an origin, we can use the relative /api path
// This allows us to make API calls through the same domain, avoiding CORS issues
const API_BASE_URL = config.restApiEndpoint;

export interface UploadJob {
  jobId: string;
  productId: string;
  status: 'pending' | 'processing' | 'extracting' | 'extracted' | 'productFormatted' | 'mergeTriggered' | 'merging' | 'completed' | 'failed' | 'error';
  files: string[];
  uploadUrls?: { [key: string]: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateUploadJobResponse {
  jobId: string;
  productId: string;
  uploadUrls: { [key: string]: string };
  status: string;
}

export interface UploadResult {
  success: boolean;
  jobId?: string;
  productId?: string;
  uploadUrls?: { [key: string]: string };
  error?: string;
}

/**
 * Service for handling product uploads
 */
export const uploadService = {
  /**
   * Create a new upload job for a product
   * @param productId - The ID of the product (new or existing)
   * @param fileNames - Array of file names to upload
   * @param isNew - Whether this is a new product (false means it's an update to an existing product)
   */
  createUploadJob: async (
    productId: string,
    fileNames: string[],
    isNew: boolean = true
  ): Promise<UploadResult> => {
    try {
      const token = await authService.getToken();
      if (!token) {
        return {
          success: false,
          error: 'User not authenticated',
        };
      }

      const url = `${API_BASE_URL}/uploads`;
      console.log(`Creating upload job at: ${url}`);
      
      const response = await fetch(url, {
        mode: 'cors',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productId,
          files: fileNames,
          isNew,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.message || 'Failed to create upload job',
        };
      }

      const data: CreateUploadJobResponse = await response.json();
      return {
        success: true,
        jobId: data.jobId,
        productId: data.productId,
        uploadUrls: data.uploadUrls,
      };
    } catch (error) {
      console.error('Error creating upload job:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },

  /**
   * Upload files to pre-signed URLs
   * @param files - The files to upload
   * @param uploadUrls - The pre-signed URLs for each file
   */
  uploadFiles: async (
    files: File[],
    uploadUrls: { [key: string]: string }
  ): Promise<UploadResult> => {
    try {
      const uploadPromises = files.map(async (file) => {
        const uploadUrl = uploadUrls[file.name];
        if (!uploadUrl) {
          throw new Error(`No upload URL found for file: ${file.name}`);
        }

        const response = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to upload file: ${file.name}`);
        }

        return file.name;
      });

      await Promise.all(uploadPromises);
      return {
        success: true,
      };
    } catch (error) {
      console.error('Error uploading files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },

  /**
   * Get the status of an upload job
   * @param jobId - The ID of the upload job
   */
  getJobStatus: async (jobId: string): Promise<UploadJob | null> => {
    try {
      const token = await authService.getToken();
      if (!token) {
        return null;
      }

      const url = `${API_BASE_URL}/uploads/${jobId}`;
      
      const response = await fetch(url, {
        mode: 'cors',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting job status:', error);
      return null;
    }
  },

  /**
   * Get all upload jobs for the current user
   */
  getUserJobs: async (): Promise<UploadJob[]> => {
    try {
      const token = await authService.getToken();
      if (!token) {
        return [];
      }

      const url = `${API_BASE_URL}/uploads/jobs`;
      console.log(`Getting user jobs from: ${url}`);
      
      const response = await fetch(url, {
        mode: 'cors',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting user jobs:', error);
      return [];
    }
  },

  /**
   * Get all upload jobs for a specific product
   * @param productId - The ID of the product
   */
  getProductJobs: async (productId: string): Promise<UploadJob[]> => {
    try {
      const token = await authService.getToken();
      if (!token) {
        return [];
      }

      const url = `${API_BASE_URL}/uploads/product/${productId}`;
      console.log(`Getting product jobs from: ${url}`);
      
      const response = await fetch(url, {
        mode: 'cors',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting product jobs:', error);
      return [];
    }
  },
};

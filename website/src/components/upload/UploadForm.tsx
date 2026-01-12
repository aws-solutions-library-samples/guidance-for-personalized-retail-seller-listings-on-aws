/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { uploadService } from '../../services/uploadService';
import { productService, Product } from '../../services/productService';
import { SampleFilesSection } from './SampleFilesSection';

export const UploadForm: React.FC = () => {
  const navigate = useNavigate();
  const [productId, setProductId] = useState('');
  const [isNew, setIsNew] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [loadProductsError, setLoadProductsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch products when isNew changes to false
  useEffect(() => {
    if (!isNew) {
      fetchProducts();
    } else {
      // Reset product ID when switching back to new product
      setProductId('');
    }
  }, [isNew]);

  // Function to fetch products
  const fetchProducts = async () => {
    try {
      setIsLoadingProducts(true);
      setLoadProductsError(null);
      const data = await productService.getAllProducts();
      setProducts(data);
    } catch (err) {
      console.error('Error fetching products:', err);
      setLoadProductsError('Failed to load products. Please try again.');
    } finally {
      setIsLoadingProducts(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Filter files to only allow .pdf, .png, .jpg, and .jpeg
      const validFiles = Array.from(e.target.files).filter(file => {
        const extension = file.name.toLowerCase().split('.').pop();
        return extension === 'pdf' || extension === 'png' || extension === 'jpg' || extension === 'jpeg';
      });
      
      // If some files were filtered out, show a warning
      if (validFiles.length < e.target.files.length) {
        setError(`Some files were ignored. Only PDF, PNG, and JPG files are allowed.`);
      } else {
        setError(null);
      }
      
      setFiles(validFiles);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Only require productId for existing product updates
    if (!isNew && !productId) {
      setError('Please enter a product ID for the existing product');
      return;
    }

    if (files.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setIsUploading(true);

    try {
      // Step 1: Create upload job and get pre-signed URLs
      const createJobResult = await uploadService.createUploadJob(
        productId,
        files.map(file => file.name),
        isNew
      );

      if (!createJobResult.success) {
        setError(createJobResult.error || 'Failed to create upload job');
        setIsUploading(false);
        return;
      }

      if (!createJobResult.uploadUrls) {
        setError('No upload URLs returned from server');
        setIsUploading(false);
        return;
      }

      // Debug: Log the uploadUrls and file names
      console.log('Upload URLs:', createJobResult.uploadUrls);
      console.log('File names:', files.map(file => file.name));

      // Step 2: Upload files to pre-signed URLs
      const uploadResult = await uploadService.uploadFiles(
        files,
        createJobResult.uploadUrls
      );

      if (!uploadResult.success) {
        setError(uploadResult.error || 'Failed to upload files');
        setIsUploading(false);
        return;
      }

      // Success - navigate to job status page
      navigate(`/job-status/${createJobResult.jobId}/${createJobResult.productId}`);
      
      // Reset form
      setProductId('');
      setIsNew(true);
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError('An unexpected error occurred during upload');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Upload Product Files</h2>
      
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-gray-700">
          The Product Description Generator uses AI to generate appealing product descriptions for online stores. 
          Simply upload your product info and images, and it generates descriptions to help sell your items.
        </p>
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <div className="flex items-center">
            <input
              id="isExistingProduct"
              type="checkbox"
              checked={!isNew}
              onChange={(e) => setIsNew(!e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={isUploading}
            />
            <label htmlFor="isExistingProduct" className="ml-2 block text-sm text-gray-700">
              Update Existing Product
            </label>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {isNew 
              ? "Creating a new product - ID will be generated automatically" 
              : "Updating an existing product - Product ID is required"}
          </p>
        </div>

        {!isNew && (
          <div className="mb-4">
            <label htmlFor="productId" className="block text-sm font-medium text-gray-700 mb-1">
              Select Product <span className="text-red-500">*</span>
            </label>
            {isLoadingProducts ? (
              <div className="flex items-center space-x-2 h-10">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="text-sm text-gray-500">Loading products...</span>
              </div>
            ) : loadProductsError ? (
              <div>
                <div className="p-3 mb-2 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
                  {loadProductsError}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchProducts}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Retry
                </Button>
              </div>
            ) : products.length === 0 ? (
              <div className="p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded text-sm">
                No products found. Please create a new product instead.
              </div>
            ) : (
              <>
                <select
                  id="productId"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isUploading}
                  required
                >
                  <option value="">-- Select a product --</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}: {product.id}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  Select the product you want to update
                </p>
              </>
            )}
          </div>
        )}

        <div className="mb-6">
          <label htmlFor="files" className="block text-sm font-medium text-gray-700 mb-1">
            Product Files
          </label>
          <input
            id="files"
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isUploading}
            multiple
            required
            accept=".pdf,.png,.jpg,.jpeg"
          />
          <p className="mt-1 text-sm text-gray-500">
            Select PDF manuals and/or product images (JPG, PNG)
          </p>
        </div>

        {files.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Selected Files:</h3>
            <ul className="list-disc pl-5 space-y-1">
              {files.map((file, index) => (
                <li key={index} className="text-sm text-gray-600">
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md transition duration-200"
          disabled={isUploading}
        >
          {isUploading ? 'Uploading...' : 'Upload Files'}
        </Button>
      </form>
      
      {/* Sample Files Section - positioned at bottom */}
      <SampleFilesSection />
    </div>
  );
};

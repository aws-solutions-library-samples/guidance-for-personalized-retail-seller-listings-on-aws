/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';

interface SampleFile {
  name: string;
  filename: string;
  type: string;
  size: string;
  icon: string;
}

interface SampleProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  files: SampleFile[];
}

interface SampleData {
  sampleProducts: SampleProduct[];
}

export const SampleFilesSection: React.FC = () => {
  const [sampleData, setSampleData] = useState<SampleData | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSectionExpanded, setIsSectionExpanded] = useState(false);

  useEffect(() => {
    fetchSampleData();
  }, []);

  const fetchSampleData = async () => {
    try {
      const response = await fetch('/samples/index.json');
      if (!response.ok) {
        throw new Error('Failed to load sample data');
      }
      const data = await response.json();
      setSampleData(data);
    } catch (err) {
      console.error('Error loading sample data:', err);
      setError('Failed to load sample files');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSection = () => {
    setIsSectionExpanded(!isSectionExpanded);
  };

  const toggleProduct = (productId: string) => {
    const newExpanded = new Set(expandedProducts);
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
    } else {
      newExpanded.add(productId);
    }
    setExpandedProducts(newExpanded);
  };

  const downloadFile = (productId: string, filename: string) => {
    const url = `/samples/${productId}/input/${filename}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAllFiles = (product: SampleProduct) => {
    product.files.forEach(file => {
      setTimeout(() => {
        downloadFile(product.id, file.filename);
      }, 100); // Small delay between downloads to avoid browser blocking
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Kitchen Appliances':
        return '🍳';
      case 'Wearable Technology':
        return '⌚';
      case 'Audio Equipment':
        return '🎧';
      case 'Home Automation':
        return '🏠';
      default:
        return '📦';
    }
  };

  if (isLoading) {
    return (
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          <span className="text-sm text-blue-700">Loading sample files...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!sampleData) {
    return null;
  }

  return (
    <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      {/* Collapsible Header */}
      <div 
        className="flex items-center justify-between cursor-pointer hover:bg-blue-100 -m-4 p-4 rounded-lg transition-colors"
        onClick={toggleSection}
      >
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-blue-900 flex items-center">
            📁 Sample Product Files
          </h3>
          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
            Try the pipeline with these examples
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-blue-600">
            {isSectionExpanded ? 'Hide samples' : 'Show samples'}
          </span>
          <span className="text-blue-600">
            {isSectionExpanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {/* Expandable Content */}
      {isSectionExpanded && (
        <div className="mt-4">
          <p className="text-sm text-blue-700 mb-4">
            Download sample product documents and images to test the processing pipeline. 
            These files demonstrate the types of content that work best with our system.
          </p>

          <div className="space-y-3">
            {sampleData.sampleProducts.map((product) => (
              <div key={product.id} className="bg-white border border-blue-200 rounded-lg">
                <div 
                  className="p-3 cursor-pointer hover:bg-blue-25 transition-colors"
                  onClick={() => toggleProduct(product.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-lg">{getCategoryIcon(product.category)}</span>
                      <div>
                        <h4 className="font-medium text-gray-900">{product.name}</h4>
                        <p className="text-sm text-gray-600">{product.description}</p>
                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded mt-1 inline-block">
                          {product.category}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadAllFiles(product);
                        }}
                        className="text-xs"
                      >
                        Download All
                      </Button>
                      <span className="text-gray-400">
                        {expandedProducts.has(product.id) ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>
                </div>

                {expandedProducts.has(product.id) && (
                  <div className="px-3 pb-3 border-t border-blue-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                      {product.files.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded border hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center space-x-2">
                            <span className="text-sm">{file.icon}</span>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{file.name}</p>
                              <p className="text-xs text-gray-500">{file.size}</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => downloadFile(product.id, file.filename)}
                            className="text-xs"
                          >
                            Download
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-100 rounded-lg">
            <h4 className="text-sm font-medium text-blue-900 mb-1">💡 How to use these samples:</h4>
            <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
              <li>Download files from any product above</li>
              <li>Use the "Choose Files" button to select the downloaded files</li>
              <li>Upload them to see how the AI processes different document types</li>
              <li>View the generated product descriptions in the Products tab</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};

/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { uploadService, UploadJob } from '../../services/uploadService';

// Define the processing stages in order
const PROCESSING_STAGES = [
  { key: 'pending', label: 'Pending', color: 'yellow' },
  { key: 'processing', label: 'Processing', color: 'blue' },
  { key: 'extracting', label: 'Extracting', color: 'blue' },
  { key: 'extracted', label: 'Extracted', color: 'blue' },
  { key: 'productFormatted', label: 'Formatted', color: 'blue' },
  { key: 'mergeTriggered', label: 'Merge Triggered', color: 'purple' },
  { key: 'merging', label: 'Merging', color: 'purple' },
  { key: 'completed', label: 'Completed', color: 'green' }
];

// Map status to stage index
const getStageIndex = (status: string): number => {
  const index = PROCESSING_STAGES.findIndex(stage => stage.key.toLowerCase() === status.toLowerCase());
  return index >= 0 ? index : 0; // Default to pending if not found
};

export const JobStatus: React.FC = () => {
  const { jobId } = useParams<{ jobId: string; productId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<UploadJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const fetchJobStatus = async () => {
    if (!jobId) {
      setError('Job ID is missing');
      setLoading(false);
      return;
    }
    
    try {
      const jobData = await uploadService.getJobStatus(jobId);
      if (jobData) {
        setJob(jobData);
        
        // If job is completed, failed, or error, stop polling
        const status = jobData.status.toLowerCase();
        if (status === 'completed' || status === 'failed' || status === 'error') {
          if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
          }
        }
      } else {
        setError('Failed to fetch job status');
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
      }
    } catch (err) {
      console.error('Error fetching job status:', err);
      setError('An error occurred while fetching job status');
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    if (jobId) {
      fetchJobStatus();
      
      // Set up polling every 5 seconds
      const interval = setInterval(fetchJobStatus, 5000);
      setPollingInterval(interval);
      
      // Clean up on unmount
      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    }
  }, [jobId]);

  const getStatusColor = (status: string) => {
    const lowerStatus = status.toLowerCase();
    switch (lowerStatus) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'processing':
      case 'extracting':
      case 'extracted':
      case 'productformatted':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'mergetriggered':
      case 'merging':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'failed':
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Render progress bar based on current status
  const renderProgressBar = (status: string) => {
    const lowerStatus = status.toLowerCase();
    // Handle error states
    if (lowerStatus === 'failed' || lowerStatus === 'error') {
      return (
        <div className="mt-4 mb-6">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div className="bg-red-600 h-2.5 rounded-full w-full"></div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>Error occurred during processing</span>
          </div>
        </div>
      );
    }

    // Get current stage index
    const currentStageIndex = getStageIndex(status);
    const totalStages = PROCESSING_STAGES.length;
    const progressPercentage = Math.round(((currentStageIndex + 1) / totalStages) * 100);

    return (
      <div className="mt-4 mb-6">
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div 
            className={`${lowerStatus === 'completed' ? 'bg-green-600' : 'bg-blue-600'} h-2.5 rounded-full`} 
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          {PROCESSING_STAGES.map((stage, index) => {
            const isActive = index <= currentStageIndex;
            const isCurrentStage = index === currentStageIndex;
            
            return (
              <div key={stage.key} className="flex flex-col items-center">
                <div 
                  className={`w-2 h-2 rounded-full mb-1 ${
                    isCurrentStage 
                      ? stage.color === 'yellow' ? 'bg-yellow-600 animate-pulse'
                        : stage.color === 'blue' ? 'bg-blue-600 animate-pulse'
                        : stage.color === 'purple' ? 'bg-purple-600 animate-pulse'
                        : stage.color === 'green' ? 'bg-green-600 animate-pulse'
                        : 'bg-gray-600 animate-pulse'
                      : isActive 
                        ? stage.color === 'yellow' ? 'bg-yellow-600'
                          : stage.color === 'blue' ? 'bg-blue-600'
                          : stage.color === 'purple' ? 'bg-purple-600'
                          : stage.color === 'green' ? 'bg-green-600'
                          : 'bg-gray-600'
                        : 'bg-gray-300'
                  }`}
                ></div>
                <span 
                  className={`${
                    isCurrentStage 
                      ? stage.color === 'yellow' ? 'text-yellow-600 font-medium'
                        : stage.color === 'blue' ? 'text-blue-600 font-medium'
                        : stage.color === 'purple' ? 'text-purple-600 font-medium'
                        : stage.color === 'green' ? 'text-green-600 font-medium'
                        : 'text-gray-600 font-medium'
                      : isActive 
                        ? stage.color === 'yellow' ? 'text-yellow-600'
                          : stage.color === 'blue' ? 'text-blue-600'
                          : stage.color === 'purple' ? 'text-purple-600'
                          : stage.color === 'green' ? 'text-green-600'
                          : 'text-gray-600'
                        : 'text-gray-400'
                  }`}
                >
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6">Job Status</h2>
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2">Loading job status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6">Job Status</h2>
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
          {error}
        </div>
        <div className="text-sm text-gray-500">
          Job ID: {jobId}
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6">Job Status</h2>
        <div className="p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded mb-4">
          Job not found
        </div>
        <div className="text-sm text-gray-500">
          Job ID: {jobId}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6">Job Status</h2>
      
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-lg font-medium">Status:</span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(job.status)}`}>
            {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
          </span>
        </div>
        
        {/* Progress Bar */}
        {renderProgressBar(job.status)}
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <span className="text-sm text-gray-500">Product ID:</span>
            <p className="font-medium">{job.productId}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Job ID:</span>
            <p className="font-medium">{job.jobId}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Created:</span>
            <p className="font-medium">{formatDate(job.createdAt)}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Updated:</span>
            <p className="font-medium">{formatDate(job.updatedAt)}</p>
          </div>
        </div>
        
        <div className="mb-4">
          <span className="text-sm text-gray-500">Files:</span>
          <ul className="list-disc pl-5 mt-1">
            {job.files.map((file, index) => (
              <li key={index} className="text-sm">{file}</li>
            ))}
          </ul>
        </div>
        
        {job.status.toLowerCase() === 'completed' && (
          <button
            onClick={() => navigate(`/products/${job.productId}`)}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition duration-200"
          >
            View Product
          </button>
        )}
        
        {(job.status.toLowerCase() === 'processing' || job.status.toLowerCase() === 'extracting') && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
              <span className="text-blue-800">Processing your files. This may take a few minutes...</span>
            </div>
          </div>
        )}
        
        {(job.status.toLowerCase() === 'mergetriggered' || job.status.toLowerCase() === 'merging') && (
          <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500 mr-2"></div>
              <span className="text-purple-800">Merging data from multiple documents. This may take a few minutes...</span>
            </div>
          </div>
        )}
        
        {(job.status.toLowerCase() === 'failed' || job.status.toLowerCase() === 'error') && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
            <span className="text-red-800">Processing failed. Automatic retries may recover processing...</span>
          </div>
        )}
      </div>
    </div>
  );
};

/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState, useEffect, useRef } from 'react';
import { authService } from '../../services/authService';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
}

interface PresignedUrlResponse {
  url: string;
  contentType: string;
  expiresIn: number;
}

const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({ 
  src, 
  alt, 
  className = '',
  onError
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const fetchPresignedUrl = async () => {
      try {
        setLoading(true);
        setError(null);
        
        console.log('Fetching presigned URL from:', src);
        
        // Get the authentication token
        const token = await authService.getToken();
        console.log('Got auth token:', token ? 'Token present' : 'No token');
        
        // Create a new request with the authentication token
        const response = await fetch(src, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        
        console.log('API response status:', response.status, response.statusText);
        
        if (!response.ok) {
          throw new Error(`Failed to get presigned URL: ${response.statusText}`);
        }
        
        // Parse the JSON response to get the presigned URL
        const data: PresignedUrlResponse = await response.json();
        console.log('Received presigned URL:', data.url);
        
        if (!data.url) {
          throw new Error('No presigned URL returned from the API');
        }
        
        // Set the presigned URL as the image source
        setImageSrc(data.url);
      } catch (err) {
        console.error('Error fetching presigned URL:', err);
        setError(err instanceof Error ? err.message : 'Failed to load image');
        
        // Call the onError callback if provided
        if (onError) {
          onError({} as React.SyntheticEvent<HTMLImageElement, Event>);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPresignedUrl();
    
    // No cleanup needed for presigned URLs
    return () => {};
  }, [src, onError]);

  if (loading) {
    return (
      <div className={`w-full h-full flex items-center justify-center ${className}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error || !imageSrc) {
    // Return a placeholder image if there's an error
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <img 
          src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2VlZWVlZSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTk5OTk5Ij5JbWFnZSBub3QgYXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg=="
          alt={alt}
          className={`object-contain max-w-full max-h-full ${className}`}
        />
        {error && (
          <div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white text-xs p-1 text-center">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <img 
        ref={imgRef}
        src={imageSrc} 
        alt={alt} 
        className={`object-contain max-w-full max-h-full ${className}`}
        onLoad={() => console.log('Image loaded successfully from presigned URL')}
        onError={(e) => {
          console.error('Image failed to load from presigned URL:', e);
          if (imgRef.current) {
            console.log('Image element:', imgRef.current.naturalWidth, imgRef.current.naturalHeight);
          }
          setError('Failed to load image from presigned URL');
        }}
      />
    </div>
  );
};

export default AuthenticatedImage;

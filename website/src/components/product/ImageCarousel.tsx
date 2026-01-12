/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import AuthenticatedImage from './AuthenticatedImage';

interface ImageCarouselProps {
  images: Array<{
    id: string;
    description?: string;
  }>;
  productId: string;
  apiBaseUrl?: string;
}

const ImageCarousel: React.FC<ImageCarouselProps> = ({ 
  images, 
  productId,
  apiBaseUrl = '/api' 
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // If there are no images, show a placeholder
  if (!images || images.length === 0) {
    return (
      <div className="aspect-square w-full bg-gray-100 flex items-center justify-center rounded-md">
        <p className="text-gray-500">No images available</p>
      </div>
    );
  }

  const goToPrevious = () => {
    const isFirstImage = currentIndex === 0;
    const newIndex = isFirstImage ? images.length - 1 : currentIndex - 1;
    setCurrentIndex(newIndex);
  };

  const goToNext = () => {
    const isLastImage = currentIndex === images.length - 1;
    const newIndex = isLastImage ? 0 : currentIndex + 1;
    setCurrentIndex(newIndex);
  };

  // Generate the image URL for the current image
  const currentImage = images[currentIndex];
  const imageUrl = `${apiBaseUrl}/products/${productId}/images/${currentImage.id}`;

  return (
    <div className="relative aspect-square w-full bg-gray-100 rounded-md overflow-hidden">
      {/* Image */}
      <div className="w-full h-full flex items-center justify-center">
        <AuthenticatedImage 
          src={imageUrl} 
          alt={currentImage.description || `Product image ${currentIndex + 1}`} 
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Navigation buttons */}
      {images.length > 1 && (
        <>
          <Button 
            variant="outline" 
            size="icon" 
            className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white rounded-full"
            onClick={goToPrevious}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="icon" 
            className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white rounded-full"
            onClick={goToNext}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </>
      )}

      {/* Image counter */}
      {images.length > 1 && (
        <div className="absolute bottom-2 left-0 right-0 text-center">
          <span className="bg-black/50 text-white px-2 py-1 rounded-full text-xs">
            {currentIndex + 1} / {images.length}
          </span>
        </div>
      )}
    </div>
  );
};

export default ImageCarousel;

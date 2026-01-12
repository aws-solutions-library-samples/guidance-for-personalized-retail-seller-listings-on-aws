/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { productService, Product } from '../../services/productService';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';
import { Button } from '../ui/button';
import { TrashIcon } from '@radix-ui/react-icons';

export const ProductList: React.FC = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for delete confirmation dialog
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await productService.getAllProducts();
        setProducts(data);
      } catch (err) {
        console.error('Error fetching products:', err);
        setError('Failed to load products');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  if (loading) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6">Your Products</h2>
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2">Loading products...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6">Your Products</h2>
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
          {error}
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6">Your Products</h2>
        <div className="p-4 bg-blue-50 border border-blue-200 text-blue-700 rounded mb-4">
          No products found. Upload product files to get started.
        </div>
      </div>
    );
  }

  // Handle opening the delete confirmation dialog
  const handleDeleteClick = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation(); // Prevent navigation to product details
    setProductToDelete(product);
    setIsDeleteDialogOpen(true);
    setDeleteError(null);
  };
  
  // Handle closing the delete confirmation dialog
  const handleCloseDeleteDialog = () => {
    setIsDeleteDialogOpen(false);
    setDeleteError(null);
  };
  
  // Handle confirming product deletion
  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      await productService.deleteProduct(productToDelete.id);
      
      // Remove the deleted product from the list
      setProducts(products.filter(p => p.id !== productToDelete.id));
      
      // Show success message
      setDeleteSuccess(`Product "${productToDelete.name}" was deleted successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setDeleteSuccess(null);
      }, 3000);
      
      // Close the dialog
      setIsDeleteDialogOpen(false);
      setProductToDelete(null);
    } catch (err) {
      console.error('Error deleting product:', err);
      setDeleteError('Failed to delete product. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6">Your Products</h2>
      
      {/* Success message */}
      {deleteSuccess && (
        <div className="p-4 mb-4 bg-green-100 border border-green-400 text-green-700 rounded">
          {deleteSuccess}
        </div>
      )}
      
      {/* Error message */}
      {deleteError && (
        <div className="p-4 mb-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {deleteError}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {products.map((product) => (
          <div 
            key={product.id} 
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => navigate(`/products/${product.id}`)}
          >
            <div className="flex items-center mb-2">
              <h3 className="text-lg font-medium">{product.name}</h3>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {product.brand && (
                <div className="text-sm text-gray-500">
                  {product.brand}
                </div>
              )}
              
              {product.model_number && (
                <div className="text-sm text-gray-500">
                  <span className="text-gray-400">Model:</span> {product.model_number}
                </div>
              )}
            </div>
            
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium">ID:</span> {product.id}
            </div>
            
            <p className="text-gray-700 text-sm mb-3 line-clamp-2">
              {product.description}
            </p>
            
            {product.categories && product.categories.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1">
                {product.categories.slice(0, 3).map((category, index) => (
                  <span 
                    key={index}
                    className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                  >
                    {category}
                  </span>
                ))}
                {product.categories.length > 3 && (
                  <span className="text-xs text-gray-500">+{product.categories.length - 3} more</span>
                )}
              </div>
            )}
            
            {product.features && product.features.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-gray-500 mb-1">Key Features:</div>
                <ul className="list-disc pl-5 text-xs text-gray-600 space-y-1">
                  {product.features.slice(0, 3).map((feature, index) => (
                    <li key={index}>
                      {typeof feature === 'string' 
                        ? feature 
                        : feature.description || feature.title}
                    </li>
                  ))}
                  {product.features.length > 3 && (
                    <li className="text-blue-600">+{product.features.length - 3} more</li>
                  )}
                </ul>
              </div>
            )}
            
            <div className="flex justify-end items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-800 hover:bg-red-50"
                onClick={(e) => handleDeleteClick(e, product)}
              >
                <TrashIcon className="h-4 w-4 mr-1" />
                Delete
              </Button>
              <button
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/products/${product.id}`);
                }}
              >
                View Details
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {/* Delete confirmation dialog */}
      {productToDelete && (
        <DeleteConfirmationDialog
          isOpen={isDeleteDialogOpen}
          productName={productToDelete.name}
          productId={productToDelete.id}
          onClose={handleCloseDeleteDialog}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
};

/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';
import { UploadForm } from './components/upload/UploadForm';
import { ProductList } from './components/product/ProductList';
import { ProductViewer } from './components/product/ProductViewer';
import { JobStatus } from './components/upload/JobStatus';
import { TabbedInterface } from './components/layout/TabbedInterface';
import config from "./config/runtime.config.json";

// Define the router
const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <div>Something went wrong!</div>,
    children: [
      {
        path: '/',
        element: <TabbedInterface />,
        children: [
          { index: true, element: <UploadForm /> },
          { path: 'products', element: <ProductList /> },
          { path: 'products/:productId', element: <ProductViewer /> },
          { path: 'job-status/:jobId/:productId', element: <JobStatus /> },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider cognitoConfig={config}>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);

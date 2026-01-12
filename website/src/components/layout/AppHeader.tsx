/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';

export const AppHeader: React.FC<{ user: any }> = ({ user }) => {
  const { signOut } = useAuth();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
  };

  // Helper function to determine if a route is active
  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <header className="bg-white shadow-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold mr-8">Product Description Generator</h1>
            <nav className="flex space-x-4">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `px-3 py-2 rounded-md text-sm font-medium ${
                    isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }`
                }
              >
                Upload
              </NavLink>
              <NavLink
                to="/products"
                className={({ isActive }) =>
                  `px-3 py-2 rounded-md text-sm font-medium ${
                    isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }`
                }
              >
                Products
              </NavLink>
              {isActive('/job-status') && (
                <NavLink
                  to="#"
                  className="px-3 py-2 rounded-md text-sm font-medium bg-blue-100 text-blue-700"
                >
                  Job Status
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center">
            {user && (
              <>
                <span className="mr-4 text-gray-600">
                  Signed in as: <span className="font-medium">{user.username}</span>
                </span>
                <Button
                  variant="outline"
                  onClick={handleSignOut}
                  className="text-gray-600 hover:text-gray-800"
                >
                  Sign Out
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

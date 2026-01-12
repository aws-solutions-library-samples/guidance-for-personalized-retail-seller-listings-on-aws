/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import { Outlet } from 'react-router-dom';
import { AuthContainer } from './components/auth/AuthContainer';
import { AppHeader } from './components/layout/AppHeader';
import { useAuth } from './contexts/AuthContext';

export default function App() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <AuthContainer />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} />
      <div className="w-[80%] max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </div>
    </div>
  );
}

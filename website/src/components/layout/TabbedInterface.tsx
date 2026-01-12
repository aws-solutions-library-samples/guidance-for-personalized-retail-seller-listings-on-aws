/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React from 'react';
import { Outlet } from 'react-router-dom';

export const TabbedInterface: React.FC = () => {
  return (
    <div className="w-[80%] max-w-7xl mx-auto px-4 py-8">
      <Outlet />
    </div>
  );
};

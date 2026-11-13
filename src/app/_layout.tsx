import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';

import { RoleProvider } from '@/features/profile/role-context';

export default function RootLayout() {
  return (
    <RoleProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </RoleProvider>
  );
}

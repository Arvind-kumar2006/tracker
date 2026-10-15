import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DashboardScreen, ImportScreen, InsightsScreen, SettingsScreen } from './src/interface/screens.js';
import { PlanCritiqueScreen } from './src/interface/PlanCritiqueScreen.js';
import { ReflectionScreen } from './src/interface/ReflectionScreen.js';
import { ReflectionQualityScreen } from './src/interface/ReflectionQualityScreen.js';
import { colors } from './src/interface/theme.js';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          initialRouteName="Dashboard"
          screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}
        >
          <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Tracker' }} />
          <Stack.Screen name="Import" component={ImportScreen} options={{ title: 'Import workbooks' }} />
          <Stack.Screen name="Reflection" component={ReflectionScreen} options={{ title: 'Daily reflection' }} />
          <Stack.Screen name="ReflectionQuality" component={ReflectionQualityScreen} options={{ title: 'Quality check' }} />
          <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: 'Insights' }} />
          <Stack.Screen name="PlanCritique" component={PlanCritiqueScreen} options={{ title: 'Plan quality' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
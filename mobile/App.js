import React from 'react';
import { Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DashboardScreen, FocusHomeScreen, ImportScreen, InsightsScreen, SettingsScreen } from './src/interface/screens.js';
import { PlanCritiqueScreen } from './src/interface/PlanCritiqueScreen.js';
import { ReflectionScreen } from './src/interface/ReflectionScreen.js';
import { ReflectionQualityScreen } from './src/interface/ReflectionQualityScreen.js';
import { DailyPlanScreen } from './src/interface/DailyPlanScreen.js';
import { FocusSessionScreen } from './src/interface/FocusSessionScreen.js';
import { colors, styles } from './src/interface/theme.js';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

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
          initialRouteName="Main"
          screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}
        >
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="FocusSession" component={FocusSessionScreen} options={{ title: 'Focus session' }} />
          <Stack.Screen name="Import" component={ImportScreen} options={{ title: 'Import workbooks' }} />
          <Stack.Screen name="ReflectionQuality" component={ReflectionQualityScreen} options={{ title: 'Quality check' }} />
          <Stack.Screen name="PlanCritique" component={PlanCritiqueScreen} options={{ title: 'Plan quality' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const TAB_META = {
  Dashboard: { label: 'Home', icon: '⌂' },
  DailyPlan: { label: 'Plan', icon: '☷' },
  Focus: { label: 'Focus', icon: '◷' },
  Reflection: { label: 'Reflect', icon: '✎' },
  Insights: { label: 'Insights', icon: '◉' },
};

function MainTabs() {
  return (
    <Tabs.Navigator
      initialRouteName="Dashboard"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primarySoft,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarIcon: ({ color, focused }) => (
          <Text style={{ color, fontSize: focused ? 21 : 19, lineHeight: 22 }}>{TAB_META[route.name]?.icon}</Text>
        ),
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarLabel: 'Home' }} />
      <Tabs.Screen name="DailyPlan" component={DailyPlanScreen} options={{ tabBarLabel: 'Plan' }} />
      <Tabs.Screen name="Focus" component={FocusHomeScreen} options={{ tabBarLabel: 'Focus' }} />
      <Tabs.Screen name="Reflection" component={ReflectionScreen} options={{ tabBarLabel: 'Reflect' }} />
      <Tabs.Screen name="Insights" component={InsightsScreen} options={{ tabBarLabel: 'Insights' }} />
    </Tabs.Navigator>
  );
}

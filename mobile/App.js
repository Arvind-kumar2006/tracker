import React from 'react';
import { Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SimpleReflectionScreen } from './src/interface/SimpleReflectionScreen.js';
import { SimplePlanScreen } from './src/interface/SimplePlanScreen.js';
import { SettingsScreen } from './src/interface/SettingsScreen.js';
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
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const TAB_META = {
  DailyPlan: { label: 'Plan', icon: '☷' },
  Reflection: { label: 'Reflect', icon: '✎' },
};

function MainTabs() {
  return (
    <Tabs.Navigator
      initialRouteName="DailyPlan"
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
      <Tabs.Screen name="DailyPlan" component={SimplePlanScreen} options={{ tabBarLabel: 'Plan' }} />
      <Tabs.Screen name="Reflection" component={SimpleReflectionScreen} options={{ tabBarLabel: 'Reflect' }} />
    </Tabs.Navigator>
  );
}

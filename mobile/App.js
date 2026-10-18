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
import { HomeScreen } from './src/interface/HomeScreen.js';
import { PlanningScreen } from './src/interface/PlanningScreen.js';
import { WeeklyPlanScreen } from './src/interface/WeeklyPlanScreen.js';
import { MonthlyPlanScreen } from './src/interface/MonthlyPlanScreen.js';
import { colors, styles } from './src/interface/theme.js';

const HomeStack = createNativeStackNavigator();
const PlanningStack = createNativeStackNavigator();
const ReflectionStack = createNativeStackNavigator();
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
        <MainTabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const TAB_META = {
  Home: { label: 'Home', icon: '⌂' },
  Planning: { label: 'Plan', icon: '☷' },
  Reflection: { label: 'Reflect', icon: '✎' },
};

function MainTabs() {
  return (
    <Tabs.Navigator
      initialRouteName="Home"
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
      <Tabs.Screen name="Home" component={HomeStackNavigator} options={{ tabBarLabel: 'Home' }} />
      <Tabs.Screen name="Planning" component={PlanningStackNavigator} options={{ tabBarLabel: 'Plan' }} />
      <Tabs.Screen name="Reflection" component={ReflectionStackNavigator} options={{ tabBarLabel: 'Reflect' }} />
    </Tabs.Navigator>
  );
}

const stackOptions = { headerShown: false };

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={stackOptions}>
      <HomeStack.Screen name="Home" component={HomeScreen} />
      <HomeStack.Screen name="DailyPlan" component={SimplePlanScreen} />
      <HomeStack.Screen name="WeeklyPlan" component={WeeklyPlanScreen} />
      <HomeStack.Screen name="MonthlyPlan" component={MonthlyPlanScreen} />
      <HomeStack.Screen name="Settings" component={SettingsScreen} />
    </HomeStack.Navigator>
  );
}

function PlanningStackNavigator() {
  return (
    <PlanningStack.Navigator screenOptions={stackOptions}>
      <PlanningStack.Screen name="Planning" component={PlanningScreen} />
      <PlanningStack.Screen name="DailyPlan" component={SimplePlanScreen} />
      <PlanningStack.Screen name="WeeklyPlan" component={WeeklyPlanScreen} />
      <PlanningStack.Screen name="MonthlyPlan" component={MonthlyPlanScreen} />
      <PlanningStack.Screen name="Settings" component={SettingsScreen} />
    </PlanningStack.Navigator>
  );
}

function ReflectionStackNavigator() {
  return (
    <ReflectionStack.Navigator screenOptions={stackOptions}>
      <ReflectionStack.Screen name="Reflection" component={SimpleReflectionScreen} />
      <ReflectionStack.Screen name="Settings" component={SettingsScreen} />
    </ReflectionStack.Navigator>
  );
}

import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Circle, Text as SvgText } from 'react-native-svg';
import { View } from 'react-native';

interface LogoProps {
  width?: number;
  height?: number;
  scale?: number;
}

export default function Logo({ width = 120, height = 36, scale = 0.3 }: LogoProps) {
  return (
    <View style={{ width, height, justifyContent: 'center', alignItems: 'center' }}>
      <Svg width={400 * scale} height={120 * scale} viewBox="0 0 400 120">
        <Defs>
          <LinearGradient id="memuGradient1" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#667eea" stopOpacity="1" />
            <Stop offset="100%" stopColor="#764ba2" stopOpacity="1" />
          </LinearGradient>
        </Defs>

        {/* Icon: Three overlapping circles */}
        <Circle cx="35" cy="60" r="22" fill="url(#memuGradient1)" opacity="0.9" />
        <Circle cx="55" cy="60" r="22" fill="url(#memuGradient1)" opacity="0.85" />
        <Circle cx="45" cy="42" r="22" fill="url(#memuGradient1)" />

        {/* Wordmark */}
        <SvgText
          x="95"
          y="75"
          fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif"
          fontSize="48"
          fontWeight="600"
          fill="url(#memuGradient1)"
        >
          memu
        </SvgText>

        {/* Telugu accent */}
        <SvgText
          x="265"
          y="70"
          fontFamily="sans-serif"
          fontSize="24"
          fontWeight="400"
          fill="#667eea"
          opacity="0.6"
        >
          మేము
        </SvgText>
      </Svg>
    </View>
  );
}

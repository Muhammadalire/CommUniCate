'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial, Float, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

interface CompanionOrbProps {
  isSpeaking: boolean;
  mood?: 'chatty' | 'gossip' | 'listener';
  scale?: number;
}

function OrbMesh({ isSpeaking, mood, scale = 1 }: CompanionOrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<any>(null);

  // Colors based on mood
  const targetColor = useMemo(() => {
    switch (mood) {
      case 'chatty': return new THREE.Color('#E9C46A'); // Warm yellow
      case 'listener': return new THREE.Color('#8ECAE6'); // Soft blue
      case 'gossip': return new THREE.Color('#E67E22'); // Terracotta
      default: return new THREE.Color('#E67E22');
    }
  }, [mood]);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.2;
      meshRef.current.rotation.y += delta * 0.3;

      // Pulse effect when speaking
      const baseScale = scale;
      const pulse = isSpeaking ? Math.sin(state.clock.elapsedTime * 8) * 0.08 : 0;
      const targetS = baseScale + pulse;
      meshRef.current.scale.lerp(new THREE.Vector3(targetS, targetS, targetS), 0.1);
    }

    if (materialRef.current) {
      materialRef.current.color.lerp(targetColor, 0.05);
      materialRef.current.distort = THREE.MathUtils.lerp(materialRef.current.distort, isSpeaking ? 0.5 : 0.2, 0.1);
      materialRef.current.speed = THREE.MathUtils.lerp(materialRef.current.speed, isSpeaking ? 4 : 2, 0.1);
    }
  });

  return (
    <Sphere ref={meshRef} args={[1.5, 64, 64]}>
      <MeshDistortMaterial
        ref={materialRef}
        envMapIntensity={1}
        clearcoat={0.8}
        clearcoatRoughness={0.2}
        metalness={0.1}
        roughness={0.4}
        color={targetColor}
      />
    </Sphere>
  );
}

export default function CompanionOrb({ isSpeaking, mood = 'chatty', scale = 1 }: CompanionOrbProps) {
  return (
    <div className="w-full h-full absolute inset-0 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 5] }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} color="#FFF7F0" />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#F4A261" />
        
        <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
          <OrbMesh isSpeaking={isSpeaking} mood={mood} scale={scale} />
        </Float>
        
        <Sparkles 
          count={isSpeaking ? 80 : 30} 
          scale={5} 
          size={isSpeaking ? 4 : 2} 
          speed={0.4} 
          opacity={isSpeaking ? 0.4 : 0.15} 
          color={mood === 'listener' ? '#8ECAE6' : '#E9C46A'} 
        />
      </Canvas>
    </div>
  );
}

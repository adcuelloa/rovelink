import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightThemeBlack from 'starlight-theme-black';

export default defineConfig({
  integrations: [
    starlight({
      title: 'RoveLink Learn',
      description: 'Interactive, bilingual guide to how RoveLink actually works.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' },
      },
      customCss: ['./src/styles/learn.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/adcuelloa/rovelink' }],
      plugins: [
        starlightThemeBlack({
          navLinks: [
            {
              slug: 'start/what-is-rovelink',
              translations: { en: 'Learn', es: 'Aprender' },
            },
            {
              slug: 'start/explore-the-system',
              translations: { en: 'Explore', es: 'Explorar' },
            },
            {
              slug: 'labs/control-pipeline',
              translations: { en: 'Labs', es: 'Laboratorios' },
            },
          ],
          docs: {
            showMarkdownActions: false,
          },
        }),
      ],
      sidebar: [
        {
          label: 'Start here',
          translations: { es: 'Empieza aquí' },
          items: [
            {
              label: 'RoveLink Overview',
              translations: { es: 'Introducción a RoveLink' },
              slug: 'start/what-is-rovelink',
            },
            {
              label: 'System Architecture',
              translations: { es: 'Arquitectura del sistema' },
              slug: 'start/explore-the-system',
            },
            {
              label: 'Control Journey',
              translations: { es: 'Flujo de control' },
              slug: 'start/r2-to-motors',
            },
          ],
        },
        {
          label: 'Control',
          translations: { es: 'Control' },
          items: [
            {
              label: 'Browser Input',
              translations: { es: 'Entrada del navegador' },
              slug: 'control/browser-input',
            },
            {
              label: 'Input Ownership',
              translations: { es: 'Control de entrada' },
              slug: 'control/input-ownership',
            },
            {
              label: 'Controller Profiles',
              translations: { es: 'Perfiles del controlador' },
              slug: 'control/controller-profiles',
            },
            {
              label: 'ControlEngine',
              translations: { es: 'ControlEngine' },
              slug: 'control/control-engine',
            },
            {
              label: 'ControlSender',
              translations: { es: 'ControlSender' },
              slug: 'control/control-sender',
            },
            {
              label: 'Rhythm & Heartbeats',
              translations: { es: 'Ritmo y heartbeats' },
              slug: 'control/rhythm-heartbeats',
            },
            {
              label: 'Control Frames',
              translations: { es: 'Control Frames' },
              slug: 'control/control-frames',
            },
            {
              label: 'Differential Drive',
              translations: { es: 'Tracción diferencial' },
              slug: 'control/differential-drive',
            },
          ],
        },
        {
          label: 'Network & Relay',
          translations: { es: 'Red y Relay' },
          items: [
            {
              label: 'Why a Relay?',
              translations: { es: '¿Por qué un relay?' },
              slug: 'network/why-relay',
            },
            {
              label: 'Browser Transport',
              translations: { es: 'Transporte del navegador' },
              slug: 'network/browser-transport',
            },
            {
              label: 'Relay Worker',
              translations: { es: 'Relay Worker' },
              slug: 'network/relay-worker',
            },
            {
              label: 'RobotRoom',
              translations: { es: 'RobotRoom' },
              slug: 'network/robot-room',
            },
            {
              label: 'The Protocol',
              translations: { es: 'El Protocolo' },
              slug: 'network/protocol',
            },
            {
              label: 'Authentication',
              translations: { es: 'Autenticación' },
              slug: 'network/authentication',
            },
            {
              label: 'Reconnection & Presence',
              translations: { es: 'Reconexión y Presencia' },
              slug: 'network/reconnection',
            },
          ],
        },
        {
          label: 'Labs',
          translations: { es: 'Laboratorios' },
          items: [
            {
              label: 'Control Flow Lab',
              translations: { es: 'Laboratorio de flujo de control' },
              slug: 'labs/control-pipeline',
            },
            {
              label: 'Differential Drive Lab',
              translations: { es: 'Laboratorio de tracción diferencial' },
              slug: 'labs/differential-drive',
            },
          ],
        },
        {
          label: 'Safety & Authority',
          translations: { es: 'Seguridad y Autoridad' },
          items: [
            {
              label: 'Safe State',
              translations: { es: 'Estado seguro' },
              slug: 'safety/safe-state',
            },
            {
              label: 'Arming & Safe Baseline',
              translations: { es: 'Armado y línea base segura' },
              slug: 'safety/safe-baseline',
            },
            {
              label: 'Control Sessions',
              translations: { es: 'Sesiones de control' },
              slug: 'safety/control-sessions',
            },
            {
              label: 'Message Ordering',
              translations: { es: 'Orden de mensajes' },
              slug: 'safety/message-ordering',
            },
            {
              label: 'TTL & Watchdog',
              translations: { es: 'TTL y watchdog' },
              slug: 'safety/ttl-watchdog',
            },
            {
              label: 'Emergency Stop',
              translations: { es: 'Parada de emergencia' },
              slug: 'safety/emergency-stop',
            },
            {
              label: 'Failure Scenarios',
              translations: { es: 'Escenarios de fallo' },
              slug: 'safety/failure-scenarios',
            },
            {
              label: 'Recovery After Reconnection',
              translations: { es: 'Recuperación tras reconexión' },
              slug: 'safety/reconnection-recovery',
            },
          ],
        },
        {
          label: 'Observability',
          translations: { es: 'Observabilidad' },
          items: [
            {
              label: 'Latency & Round-Trip Time',
              translations: { es: 'Latencia y tiempo de ida y vuelta' },
              slug: 'labs/rtt',
            },
          ],
        },
      ],
    }),
    react(),
  ],
});

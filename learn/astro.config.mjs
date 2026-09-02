import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
      components: {
        Header: './src/components/starlight/Header.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
      },
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
          label: 'Labs',
          translations: { es: 'Laboratorios' },
          items: [
            {
              label: 'Control Flow Lab',
              translations: { es: 'Laboratorio de flujo de control' },
              slug: 'labs/control-pipeline',
            },
            {
              label: 'Differential Drive',
              translations: { es: 'Tracción diferencial' },
              slug: 'labs/differential-drive',
            },
          ],
        },
        {
          label: 'Safety',
          translations: { es: 'Seguridad' },
          items: [
            {
              label: 'Connection Safety',
              translations: { es: 'Seguridad de conexión' },
              slug: 'labs/ttl',
            },
            {
              label: 'Sessions & Message Ordering',
              translations: { es: 'Sesiones y orden de mensajes' },
              slug: 'labs/session-sequence',
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

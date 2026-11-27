import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

// Configure PWA metadata for the web platform only.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.json';
    document.head.appendChild(manifest);

    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = '#191970';
    document.head.appendChild(themeColor);

    // Register Service Worker in production builds only.
    if (!__DEV__ && 'serviceWorker' in navigator) {
        const registerServiceWorker = () => {
            navigator.serviceWorker
                .register('/service-worker.js')
                .then((registration) => {
                    console.log(
                        'CampusReport Service Worker registered:',
                        registration.scope
                    );
                })
                .catch((error) => {
                    console.error(
                        'Service Worker registration failed:',
                        error
                    );
                });
        };

        if (document.readyState === 'complete') {
            registerServiceWorker();
        } else {
            window.addEventListener('load', registerServiceWorker);
        }
    }
}

// Register the main application component.
registerRootComponent(App);

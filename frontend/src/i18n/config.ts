import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: localStorage.getItem('ala_language') || (navigator.language.startsWith('zh') ? 'zh' : 'en'),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18next

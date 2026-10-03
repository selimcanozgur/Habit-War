/**
 * Kayıt ekranı.
 *
 * E-posta ve şifre alır, giriş ekranına geçiş bağlantısı var.
 * Şifre gereksinimleri girişte hemen gösterilir, kullanıcı bir karakterle bile olmadan
 * ne beklediğini bilir.
 */

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { FormField } from '../../src/components/FormField';
import { colors, radius, spacing, type } from '../../src/theme';

export default function SignUpScreen(): React.JSX.Element {
  const { signUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  function clearErrors(): void {
    setEmailError('');
    setPasswordError('');
    setConfirmError('');
    setGeneralError('');
  }

  async function handleSignUp(): Promise<void> {
    clearErrors();

    const trimmedEmail = email.trim().toLowerCase();
    let hasError = false;

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setEmailError('Geçerli bir e-posta adresi gir');
      hasError = true;
    }
    if (password.length < 8) {
      setPasswordError('Şifren en az 8 karakter olmalı');
      hasError = true;
    }
    if (password !== confirm) {
      setConfirmError('Şifreler eşleşmiyor');
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    try {
      await signUp(trimmedEmail, password);
      // AuthProvider sets the session; root layout redirects to (tabs).
    } catch (error) {
      if (error instanceof ApiError) {
        switch (error.code) {
          case 'EMAIL_TAKEN':
            setEmailError('Bu e-posta adresiyle zaten bir hesap var');
            break;
          case 'PASSWORD_TOO_SHORT':
            setPasswordError('Şifren en az 8 karakter olmalı');
            break;
          case 'PASSWORD_TOO_LONG':
            setPasswordError('Şifren çok uzun');
            break;
          case 'PASSWORD_COMMON':
            setPasswordError('Bu şifre çok yaygın, başka bir şifre seç');
            break;
          default:
            setGeneralError('Kayıt olunamadı. Lütfen tekrar dene.');
        }
      } else {
        setGeneralError('Bağlantı hatası. İnternet bağlantını kontrol et.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.avoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Habit War'a katıl</Text>
            <Text style={styles.subtitle}>Ücretsiz hesap oluştur</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {generalError ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{generalError}</Text>
              </View>
            ) : null}

            <FormField
              label="E-posta"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (emailError) setEmailError('');
                if (generalError) setGeneralError('');
              }}
              error={emailError}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="ornek@mail.com"
            />

            <FormField
              ref={passwordRef}
              label="Şifre"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (passwordError) setPasswordError('');
              }}
              error={passwordError}
              hint="En az 8 karakter"
              secure
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
            />

            <FormField
              ref={confirmRef}
              label="Şifreyi onayla"
              value={confirm}
              onChangeText={(value) => {
                setConfirm(value);
                if (confirmError) setConfirmError('');
              }}
              error={confirmError}
              secure
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={() => void handleSignUp()}
            />
          </View>

          {/* CTA */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                loading && styles.primaryButtonDisabled,
              ]}
              onPress={() => void handleSignUp()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Kayıt ol"
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnDark} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Kayıt Ol</Text>
              )}
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Zaten hesabın var mı? </Text>
              <Pressable onPress={() => router.replace('/(auth)/sign-in')}>
                <Text style={styles.link}>Giriş yap</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  avoid: { flex: 1 },
  scroll: { flex: 1 },

  content: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.xl,
  },

  header: { gap: spacing.xs },
  title: { ...type.heading, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted },

  form: { gap: spacing.md },

  banner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
  },
  bannerText: { ...type.body, color: colors.danger },

  link: { ...type.body, color: colors.accent, fontFamily: 'Nunito_700Bold' },

  actions: { gap: spacing.md },

  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonPressed: { opacity: 0.82 },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: {
    ...type.body,
    fontFamily: 'Nunito_800ExtraBold',
    color: colors.textOnDark,
    fontSize: 16,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: { ...type.body, color: colors.textMuted },
});

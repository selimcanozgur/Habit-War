/**
 * Giriş ekranı.
 *
 * Yeni kullanıcı buraya gelince kayıt ekranına geçebilir; şifresini unutursa sıfırlama
 * ekranına. Tasarım, parchment temasına uyuyor — açık kağıt rengi yüzey, koyu çerçeve.
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

export default function SignInScreen(): React.JSX.Element {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  function clearErrors(): void {
    setEmailError('');
    setPasswordError('');
    setGeneralError('');
  }

  async function handleSignIn(): Promise<void> {
    clearErrors();

    const trimmedEmail = email.trim().toLowerCase();

    // Client-side pre-check so trivial mistakes get instant feedback.
    let hasError = false;
    if (!trimmedEmail) {
      setEmailError('E-posta adresini gir');
      hasError = true;
    }
    if (!password) {
      setPasswordError('Şifreni gir');
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    try {
      await signIn(trimmedEmail, password);
      // AuthProvider updates the session, root layout redirects to (tabs).
    } catch (error) {
      if (error instanceof ApiError) {
        switch (error.code) {
          case 'INVALID_CREDENTIALS':
            // Same message for unknown email and wrong password — telling which one
            // is correct would let an attacker enumerate accounts.
            setGeneralError('E-posta veya şifre hatalı');
            break;
          case 'EMAIL_NOT_VERIFIED':
            setGeneralError('E-posta adresini doğrulamadan giriş yapamazsın');
            break;
          case 'ACCOUNT_SUSPENDED':
            setGeneralError('Bu hesap askıya alındı');
            break;
          default:
            setGeneralError('Giriş yapılamadı. Lütfen tekrar dene.');
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
            <Text style={styles.title}>Tekrar hoş geldin</Text>
            <Text style={styles.subtitle}>Hesabına giriş yap</Text>
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
                if (generalError) setGeneralError('');
              }}
              error={passwordError}
              secure
              textContentType="password"
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={() => void handleSignIn()}
            />

            <Pressable
              onPress={() => router.push('/(auth)/forgot-password')}
              style={styles.forgotLink}
            >
              <Text style={styles.link}>Şifremi unuttum</Text>
            </Pressable>
          </View>

          {/* CTA */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, loading && styles.primaryButtonDisabled]}
              onPress={() => void handleSignIn()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Giriş yap"
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnDark} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Giriş Yap</Text>
              )}
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Hesabın yok mu? </Text>
              <Pressable onPress={() => router.replace('/(auth)/sign-up')}>
                <Text style={styles.link}>Kayıt ol</Text>
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

  forgotLink: { alignSelf: 'flex-end' },
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

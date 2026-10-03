/**
 * Şifre sıfırlama talebi.
 *
 * E-posta girer, bir bağlantı gönderilir. Gönderildikten sonra onay mesajı gösterilir
 * ve adres değiştirilemez — çift gönderi veya tahmin etme girişimlerini zorlaştırır.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestPasswordReset } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import { FormField } from '../../src/components/FormField';
import { Icon } from '../../src/components/Icon';
import { colors, radius, spacing, type } from '../../src/theme';

type Step = 'form' | 'sent';

export default function ForgotPasswordScreen(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('form');

  async function handleSubmit(): Promise<void> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setEmailError('Geçerli bir e-posta adresi gir');
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(trimmed);
      setStep('sent');
    } catch (error) {
      // The server always returns 204, even for unknown emails, to prevent enumeration.
      // A network error is the only real failure here.
      if (error instanceof ApiError && error.code === 'NETWORK') {
        setEmailError('Bağlantı hatası. İnternet bağlantını kontrol et.');
      } else {
        // Treat any other error the same as success to avoid leaking information.
        setStep('sent');
      }
    } finally {
      setLoading(false);
    }
  }

  if (step === 'sent') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.sentContainer}>
          <View style={styles.sentIconWrap}>
            <Icon name="check-circle" size={48} color={colors.accent} />
          </View>
          <Text style={styles.sentTitle}>Bağlantı gönderildi</Text>
          <Text style={styles.sentBody}>
            Eğer bu adresle bir hesap varsa, sıfırlama bağlantısı birkaç dakika içinde gelecek. Spam
            klasörünü de kontrol et.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            onPress={() => router.replace('/(auth)/sign-in')}
            accessibilityRole="button"
            accessibilityLabel="Giriş ekranına dön"
          >
            <Text style={styles.primaryButtonText}>Giriş Ekranına Dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
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
          {/* Back */}
          <Pressable
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Geri"
          >
            <Icon name="arrow-left" size={22} color={colors.textMuted} />
          </Pressable>

          <View style={styles.header}>
            <Text style={styles.title}>Şifreni sıfırla</Text>
            <Text style={styles.subtitle}>
              E-posta adresini gir, sıfırlama bağlantısı gönderelim.
            </Text>
          </View>

          <View style={styles.form}>
            <FormField
              label="E-posta"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (emailError) setEmailError('');
              }}
              error={emailError}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="go"
              onSubmitEditing={() => void handleSubmit()}
              placeholder="ornek@mail.com"
            />
          </View>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                loading && styles.primaryButtonDisabled,
              ]}
              onPress={() => void handleSubmit()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Sıfırlama bağlantısı gönder"
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnDark} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Bağlantı Gönder</Text>
              )}
            </Pressable>
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
    gap: spacing.xl,
  },

  backButton: {
    alignSelf: 'flex-start',
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },

  header: { gap: spacing.xs },
  title: { ...type.heading, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, lineHeight: 22 },

  form: { gap: spacing.md },

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

  // Sent state
  sentContainer: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.lg,
    alignItems: 'center',
  },
  sentIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentTitle: { ...type.heading, color: colors.text, textAlign: 'center' },
  sentBody: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
});

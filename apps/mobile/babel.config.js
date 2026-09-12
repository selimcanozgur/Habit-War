module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin must stay last; Reanimated's worklets are
    // compiled by it and it rewrites code the other plugins produce.
    plugins: ['react-native-worklets/plugin'],
  };
};

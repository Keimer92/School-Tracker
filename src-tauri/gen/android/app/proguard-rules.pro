# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# --- JNI bridge con Rust (llamados por nombre desde lib.rs) ---
# Estos métodos solo se invocan vía JNI desde Rust; R8 no los ve como
# usados y los eliminaría/renombraría en release con minify habilitado.
-keep class com.keimer.schooltracker.MainActivity {
    public void startGoogleSignIn(java.lang.String);
    public void requestNotificationPermissionNow();
    void initNativeBridge();
}
-keepclasseswithmembernames class * {
    native <methods>;
}
-keep class com.keimer.schooltracker.AttendanceNative {
    public *;
}
-keep class com.keimer.schooltracker.AttendancePrefs {
    public *;
}

# Si tu proyecto usa WebView con JS, descomenta la siguiente línea:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
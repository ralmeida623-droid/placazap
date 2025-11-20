import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, Linking, StyleSheet, FlatList, Alert, Share } from 'react-native';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { scanOCR } from 'expo-mlkit-ocr';

const STORAGE_KEY = '@leitor_placas_logs_v1';

export default function App() {
  const [hasPermission, setHasPermission] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [plate, setPlate] = useState('');
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const cameraRef = useRef(null);

  const mercosul = /[A-Z]{3}[0-9][A-Z][0-9]{2}/g;
  const antigo = /[A-Z]{3}-?[0-9]{4}/g;

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setLogs(JSON.parse(raw));
      } catch (e) { console.warn(e); }
    })();
  }, []);

  const extractPlate = (text) => {
    const upper = (text || '').toUpperCase();
    const m1 = upper.match(mercosul);
    const m2 = upper.match(antigo);
    if (m1 && m1.length) return m1[0];
    if (m2 && m2.length) return m2[0];
    return '';
  };

  const saveLog = async (entry) => {
    try {
      const newLogs = [entry, ...logs];
      setLogs(newLogs);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newLogs));
    } catch (e) { console.warn('Erro salvando log', e); }
  };

  const handleCapture = async () => {
    try {
      if (!cameraRef.current) return;
      setProcessing(true);
      const photo = await cameraRef.current.takePictureAsync({ base64: false });

      let fullText = '';
      try {
        const result = await scanOCR(photo.uri);
        fullText = result?.text || '';
      } catch (e) {
        console.warn('OCR falhou', e);
      }

      setOcrText(fullText);
      const guessed = extractPlate(fullText);
      setPlate(guessed);

      let location = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
        }
      } catch (e) { console.warn('Erro localização', e); }

      const timestamp = new Date().toISOString();
      const entry = {
        id: `${Date.now()}`,
        plate: guessed,
        fullText,
        timestamp,
        lat: location?.coords?.latitude ?? null,
        lon: location?.coords?.longitude ?? null
      };

      await saveLog(entry);
      Alert.alert('Leitura registrada', `Placa: ${guessed || 'Não detectada'}\nHora: ${timestamp}`);

    } catch (e) {
      console.error(e);
      Alert.alert('Erro', 'Falha ao capturar/ler a imagem.');
    } finally {
      setProcessing(false);
    }
  };

  const sendWhatsApp = () => {
    const textToSend = plate || ocrText;
    if (!textToSend) { Alert.alert('Nada para enviar'); return; }
    const url = `https://wa.me/?text=${encodeURIComponent(textToSend)}`;
    Linking.openURL(url);
  };

  const exportCSV = async () => {
    if (!logs.length) { Alert.alert('Histórico vazio'); return; }
    const header = 'id,plate,fullText,timestamp,lat,lon\n';
    const rows = logs.map(l => `${l.id},"${(l.plate||'').replace(/"/g,'""')}","${(l.fullText||'').replace(/"/g,'""')}",${l.timestamp},${l.lat ?? ''},${l.lon ?? ''}`).join('\n');
    const csv = header + rows;
    const path = FileSystem.cacheDirectory + `leitor_placas_${Date.now()}.csv`;
    await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
    try { await Share.share({ url: path, title: 'Leitor de Placas - export' }); } catch (e) { Alert.alert('Erro ao compartilhar', e.message); }
  };

  const clearLogs = async () => {
    Alert.alert('Confirmar', 'Deseja apagar todo o histórico?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => { await AsyncStorage.removeItem(STORAGE_KEY); setLogs([]); } }
    ]);
  };

  if (hasPermission === null) return <View />;
  if (hasPermission === false) {
    return (
      <View style={styles.center}><Text>Sem permissão de câmera.</Text></View>
    );
  }

  return (

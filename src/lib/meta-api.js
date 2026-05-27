/**
 * META WhatsApp Cloud API Client
 * Wrapper complet pour l'API Graph META WhatsApp Business
 */

const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const BASE_URL = 'https://graph.facebook.com/' + API_VERSION;

class MetaWhatsAppAPI {
  constructor(phoneNumberId, accessToken) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    this.messagesUrl = BASE_URL + '/' + phoneNumberId + '/messages';
    this.mediaUrl = BASE_URL + '/' + phoneNumberId + '/media';
    this.profileUrl = BASE_URL + '/' + phoneNumberId + '/whatsapp_business_profile';
  }

  async _request(url, options) {
    const defaults = {
      headers: {
        'Authorization': 'Bearer ' + this.accessToken,
        'Content-Type': 'application/json'
      }
    };
    const opts = Object.assign({}, defaults, options);
    if (options && options.headers) {
      opts.headers = Object.assign({}, defaults.headers, options.headers);
    }

    const response = await fetch(url, opts);
    const data = await response.json();

    if (!response.ok) {
      const err = new Error(data.error ? data.error.message : 'META API Error');
      err.status = response.status;
      err.meta = data.error || data;
      throw err;
    }

    return data;
  }

  // ══════════════════════════════════════════════════
  // ENVOI DE MESSAGES
  // ══════════════════════════════════════════════════

  async sendText(to, body, previewUrl) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: body, preview_url: previewUrl || false }
      })
    });
  }

  async sendImage(to, imageId, caption) {
    const image = { id: imageId };
    if (caption) image.caption = caption;
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'image',
        image: image
      })
    });
  }

  async sendImageUrl(to, url, caption) {
    const image = { link: url };
    if (caption) image.caption = caption;
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'image',
        image: image
      })
    });
  }

  async sendVideo(to, videoId, caption) {
    const video = { id: videoId };
    if (caption) video.caption = caption;
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'video',
        video: video
      })
    });
  }

  async sendVideoUrl(to, url, caption) {
    const video = { link: url };
    if (caption) video.caption = caption;
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'video',
        video: video
      })
    });
  }

  async sendDocument(to, documentId, caption, filename) {
    const document = { id: documentId };
    if (caption) document.caption = caption;
    if (filename) document.filename = filename;
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'document',
        document: document
      })
    });
  }

  async sendDocumentUrl(to, url, caption, filename) {
    const document = { link: url };
    if (caption) document.caption = caption;
    if (filename) document.filename = filename;
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'document',
        document: document
      })
    });
  }

  async sendAudio(to, audioId) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'audio',
        audio: { id: audioId }
      })
    });
  }

  async sendAudioUrl(to, url) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'audio',
        audio: { link: url }
      })
    });
  }

  async sendLocation(to, latitude, longitude, name, address) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'location',
        location: { latitude: latitude, longitude: longitude, name: name, address: address }
      })
    });
  }

  async sendContacts(to, contacts) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'contacts',
        contacts: contacts
      })
    });
  }

  async sendSticker(to, stickerId) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'sticker',
        sticker: { id: stickerId }
      })
    });
  }

  // ── Messages interactifs ──

  async sendButtons(to, bodyText, buttons, headerText, footerText) {
    // Max 3 boutons, titre max 20 chars
    const interactive = {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(function(b) {
          return { type: 'reply', reply: { id: b.id, title: b.title } };
        })
      }
    };
    if (headerText) interactive.header = { type: 'text', text: headerText };
    if (footerText) interactive.footer = { text: footerText };

    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: interactive
      })
    });
  }

  async sendList(to, bodyText, buttonText, sections, headerText, footerText) {
    const interactive = {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText,
        sections: sections
      }
    };
    if (headerText) interactive.header = { type: 'text', text: headerText };
    if (footerText) interactive.footer = { text: footerText };

    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: interactive
      })
    });
  }

  async sendCatalog(to, bodyText, thumbnailProductId, footerText) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'catalog_message',
          body: { text: bodyText },
          footer: footerText ? { text: footerText } : undefined,
          action: { name: 'catalog_message', parameters: { thumbnail_product_retailer_id: thumbnailProductId } }
        }
      })
    });
  }

  // ── Templates ──

  async sendTemplate(to, templateName, languageCode, components) {
    const template = {
      name: templateName,
      language: { code: languageCode || 'fr' }
    };
    if (components) template.components = components;

    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'template',
        template: template
      })
    });
  }

  // ── Réactions ──

  async sendReaction(to, messageId, emoji) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'reaction',
        reaction: { message_id: messageId, emoji: emoji }
      })
    });
  }

  async removeReaction(to, messageId) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'reaction',
        reaction: { message_id: messageId, emoji: '' }
      })
    });
  }

  // ── Marquer comme lu ──

  async markAsRead(messageId) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      })
    });
  }

  // ── Typing indicator ──

  async sendTypingIndicator(messageId) {
    return this._request(this.messagesUrl, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' }
      })
    });
  }

  // ══════════════════════════════════════════════════
  // MEDIA
  // ══════════════════════════════════════════════════

  async getMediaUrl(mediaId) {
    return this._request(BASE_URL + '/' + mediaId, { method: 'GET' });
  }

  async downloadMedia(url) {
    const response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + this.accessToken }
    });
    if (!response.ok) throw new Error('Download failed: ' + response.status);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type')
    };
  }

  async uploadMedia(buffer, mimeType, filename) {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', buffer, { filename: filename || 'file', contentType: mimeType });
    form.append('type', mimeType);

    const response = await fetch(this.mediaUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this.accessToken },
      body: form
    });
    return response.json();
  }

  async deleteMedia(mediaId) {
    return this._request(BASE_URL + '/' + mediaId, { method: 'DELETE' });
  }

  // ══════════════════════════════════════════════════
  // TEMPLATES
  // ══════════════════════════════════════════════════

  async listTemplates(wabaId, limit) {
    const url = BASE_URL + '/' + wabaId + '/message_templates?limit=' + (limit || 100);
    return this._request(url, { method: 'GET' });
  }

  async createTemplate(wabaId, template) {
    return this._request(BASE_URL + '/' + wabaId + '/message_templates', {
      method: 'POST',
      body: JSON.stringify(template)
    });
  }

  async deleteTemplate(wabaId, templateName) {
    return this._request(BASE_URL + '/' + wabaId + '/message_templates?name=' + templateName, {
      method: 'DELETE'
    });
  }

  // ══════════════════════════════════════════════════
  // BUSINESS PROFILE
  // ══════════════════════════════════════════════════

  async getProfile() {
    return this._request(this.profileUrl + '?fields=about,address,description,email,profile_picture_url,websites,vertical', {
      method: 'GET'
    });
  }

  async updateProfile(data) {
    return this._request(this.profileUrl, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ messaging_product: 'whatsapp' }, data))
    });
  }
}

module.exports = MetaWhatsAppAPI;

import pandas as pd
import json
import matplotlib.pyplot as plt
import seaborn as sns
import os
from collections import Counter
import re
from wordcloud import WordCloud
import matplotlib



# Стоп-слова
stop_words = ['text', 'type', 'from', 'from_id', 'date', 'date_unixtime', 'reply_to_message_id', 'text_entities', 'id', 'source_file', 'plain', 'date_only', 'и', 'n', 'bold', 'startapp', 'tx', 'vucmpglrhg', 'for', '10', 'www', 'их', 'тот', '00', '55', 'trade', 'xrocket', 'cex', 'mention', 'stickers', '4', 'supply', 'bot', 'меня', '6', '56', 'link', 'ton_ref', '', 'https', 'href', 'custom_emoji', 'animatedsticker', 'webp', 'dev', 'net', 'было', 'spent', 'bought', 'bot_command', 'website', 'giu_hub', 'startapp', '', '', 'подписаться', 'tgs', 'sticker', 'video_files', 'webm', 'но', 'у', 'до', 'из', 'его', 'если', 'вот', 'там', 'же', '10', '000', '3', 'а', 'за', 'то', 'от', 'ну', 'ты', 'a', 'x', '327', '99', '796', 'a', 'document_id', '2', '', '', 'text_link', 'mention_name', 'user_id', 't', 'me', 'com', 'a', 'italic', 'new', '5', '0', '1', 'в', 'на', 'с', 'к', 'по', 'для', 'о', 'об', 'что', 'так', 'как', 'также', 'или', 'так', 'этот', 'тот', 'это', 'мне', 'мы', 'вы', 'они', 'он', 'она', 'оно', 'я', 'потому', 'потому что', 'да', 'нет', 'не', 'быть', 'есть', 'был', 'бы', 'уже', 'очень', 'даже', 'такой', 'когда', 'где', 'куда', 'зачем', 'перед', 'после', 'через', 'сейчас', 'еще', 'несколько', 'поэтому', 'чтобы', 'все', 'всегда', 'когда-то', 'кто', 'что-то']


# Словарь с соответствием имени файла и желаемого названия для графика
file_to_title = {
    'result.json': 'CryptoCoder chat',
    'result(2).json': 'PovelDurev chat',
    'result(3).json': 'Prometheus chat',
    # Добавьте другие файлы и их соответствующие названия
}

# Функция для загрузки данных из JSON-файлов
def load_messages():
    all_messages = []
    for i in range(1, 4):
        filename = f'result({i}).json' if i > 1 else 'result.json'
        if os.path.exists(filename):
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for message in data['messages']:
                    message['source_file'] = filename
                all_messages.extend(data['messages'])
            print(f"Загружен файл: {filename}")
        else:
            print(f"Файл не найден: {filename}")
    return all_messages

# Загрузка данных
messages = load_messages()
df = pd.DataFrame(messages)

# Предварительная очистка данных
# Убираем сообщения без текста и с медиа
df = df[df['type'] == 'message']
df = df.dropna(subset=['text'])

# Преобразование даты
df['date'] = pd.to_datetime(df['date'])
df['date_only'] = df['date'].dt.date

# Функция для анализа статистики
def analyze_statistics(subset):
    # Активность по дням
    daily_activity = subset.groupby('date_only').size()
    avg_daily_activity = daily_activity.mean()
    median_daily_activity = daily_activity.median()

    # Средняя активность по часам
    subset.loc[:, 'hour'] = subset['date'].dt.hour
    hourly_activity = subset.groupby('hour').size()
    avg_hourly_activity = hourly_activity.mean()
    median_hourly_activity = hourly_activity.median()

    # Медианная активность по авторам
    author_activity = subset['from'].value_counts()
    median_author_activity = author_activity.median()

    return avg_daily_activity, median_daily_activity, avg_hourly_activity, median_hourly_activity, median_author_activity

# Функция для анализа популярных слов и пользователей
def analyze_file_data(subset):
    
    # Анализ самых популярных слов
    all_text = ' '.join(subset['text'].astype(str))
    words = re.findall(r'\w+', all_text.lower())
    filtered_words = [word for word in words if word not in stop_words]
    common_words = Counter(filtered_words).most_common(20)  # Ограничиваем количество слов 20

    # Анализ активности по авторам
    author_activity = subset['from'].value_counts().head(10)

    return common_words, author_activity

# Визуализация активности по каждому файлу
plt.figure(figsize=(18, 24))  
for i, filename in enumerate(df['source_file'].unique(), 1):
    subset = df[df['source_file'] == filename]
    file_title = file_to_title.get(filename, filename)  # Используем название из словаря

    # 1. Статистика по дням
    avg_daily_activity, median_daily_activity, avg_hourly_activity, median_hourly_activity, median_author_activity = analyze_statistics(subset)

    
    print(f"\nСтатистика для {file_title}:")
    print(f"Средняя активность по дням: {avg_daily_activity}")
    print(f"Медианная активность по дням: {median_daily_activity}")
    print(f"Средняя активность в течение суток: {avg_hourly_activity}")
    print(f"Медианная активность в течение суток: {median_hourly_activity}")
    print(f"Медианная активность по авторам: {median_author_activity}")

    # 2. График активности по дням
    plt.subplot(6, 1, i)
    daily_activity = subset.groupby('date_only').size().reset_index(name='message_count')
    sns.lineplot(data=daily_activity, x='date_only', y='message_count')
    plt.title(f'Активность по дням ({file_title})')
    plt.xlabel('Дата')
    plt.ylabel('Количество сообщений')
    plt.xticks(rotation=45)

    # 3. Средняя активность в течение суток
    plt.figure(figsize=(12, 8))
    hourly_activity = subset.groupby('hour').size().reset_index(name='message_count')
    sns.lineplot(data=hourly_activity, x='hour', y='message_count')
    plt.title(f'Средняя активность по часам ({file_title})')
    plt.xlabel('Час')
    plt.ylabel('Количество сообщений')
    plt.xticks(range(0, 24))
    plt.tight_layout()
    plt.show()

    # 4. Анализ данных по каждому файлу
    common_words, author_activity = analyze_file_data(subset)

    # 5. График самых активных пользователей
    plt.figure(figsize=(12, 8))
    sns.barplot(x=author_activity.values, y=author_activity.index)
    plt.title(f'Топ-10 самых активных пользователей для {file_title}')
    plt.xlabel('Количество сообщений')
    plt.ylabel('Пользователи')
    plt.tight_layout()
    plt.savefig(f'top_authors_{file_title}.png')
    plt.show()

    # 6. График популярных слов
    plt.figure(figsize=(12, 8))
    words, counts = zip(*common_words)
    sns.barplot(x=list(counts), y=list(words))
    plt.title(f'Популярные слова для {file_title}')
    plt.xlabel('Частота использования')
    plt.ylabel('Слова')
    plt.tight_layout()
    plt.savefig(f'top_words_{file_title}.png')
    plt.show()

    # 7. Облако слов
    plt.figure(figsize=(12, 8))
    wordcloud = WordCloud(width=800, height=400, background_color='white').generate_from_frequencies(dict(common_words))
    plt.imshow(wordcloud, interpolation='bilinear')
    plt.axis('off')
    plt.title(f'Облако слов для {file_title}')
    plt.tight_layout()
    plt.show()



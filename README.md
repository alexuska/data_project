
# ссылка на файлы, использованные в проекте: https://drive.google.com/drive/folders/1HrzPYob0wsp5-kVrHPlo2kxk7hODoJH5?usp=drive_link

# Исследовательский проект: Анализ сообщений Telegram-чата

## Описание проекта

В данном проекте производится анализ сообщений из Telegram-чата. Анализ включает в себя следующие этапы:
- Загрузка и очистка данных
- Анализ активности пользователей по дням и часам
- Выявление популярных слов и пользователей
- Визуализация результатов

Проект использует данные из файлов JSON, содержащих сообщения из различных Telegram-чатов. Все данные открыты для использования и не содержат персональных данных.

## Загрузка и подготовка данных

Для начала загружаются данные из нескольких JSON-файлов. В каждом файле содержатся сообщения чата с метаданными. Все данные очищаются от сообщений без текста и с медиа.

```python
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
